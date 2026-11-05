import { z } from "zod";
import type Database from "better-sqlite3";
import {
  maskEmail,
  maskEmailsInText,
  parseOmnirouteUsage,
  summarizeRateLimit,
} from "@vg/shared";
import type { TokenVault } from "../publishing/tokenVault.js";
import {
  NONE_QUOTA_KEY,
  OMNIROUTE_MANAGEMENT_TOKEN_KEY,
  keepConnectionError,
  readSyncState,
  replaceConnectionSnapshots,
  setRateLimitNotes,
  writeSyncState,
  type QuotaSnapshot,
} from "../providers/llm/omnirouteQuotaStore.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MIN_GAP_MS = 60_000;

export type SyncLogger = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

const connectionSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  name: z.string().optional(),
  label: z.string().optional(),
  isActive: z.boolean().optional(),
  active: z.boolean().optional(),
  email: z.string().optional(),
}).passthrough();

export function managementOrigin(baseUrl: string | undefined): string {
  const raw = (baseUrl || "http://127.0.0.1:20128/v1").trim();
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "") || "http://127.0.0.1:20128";
}

export class OmniRouteQuotaSync {
  private tail: Promise<void> = Promise.resolve();
  private lastRefreshMs = 0;

  constructor(private readonly deps: {
    sqlite: Database.Database;
    vault: TokenVault;
    baseUrl: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    logger?: SyncLogger;
    now?: () => Date;
  }) {}

  origin(): string {
    return managementOrigin(this.deps.baseUrl);
  }

  tokenMeta(): { saved: boolean; last4: string | null } {
    const token = this.deps.vault.loadSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY);
    if (!token) return { saved: false, last4: null };
    return { saved: true, last4: token.slice(-4) };
  }

  saveToken(token: string): { saved: true; last4: string } {
    this.deps.vault.storeSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY, token);
    this.lastRefreshMs = 0;
    return { saved: true, last4: token.slice(-4) };
  }

  removeToken(): void {
    this.deps.vault.deleteSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY);
    this.lastRefreshMs = 0;
  }

  start(): () => void {
    const timer = setInterval(() => {
      if (process.env.VITEST) return;
      void this.refresh(false).catch(() => undefined);
    }, 5 * 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  async refreshIfDue(): Promise<void> {
    const state = readSyncState(this.deps.sqlite);
    const fetched = state.fetchedAt ? Date.parse(state.fetchedAt) : Number.NaN;
    if (Number.isFinite(fetched) && this.now().getTime() - fetched < 5 * 60_000) return;
    await this.refresh(false);
  }

  refresh(manual = false): Promise<void> {
    const run = this.tail.then(() => this.refreshInner(manual));
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private credential(): string | null {
    const token = this.deps.vault.loadSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY)?.trim();
    if (token) return token;
    const apiKey = this.deps.apiKey?.trim();
    return apiKey || null;
  }

  private redact(text: string): string {
    const secret = this.credential();
    if (!secret || secret.length < 4) return maskEmailsInText(text);
    return maskEmailsInText(text.split(secret).join("[redacted]"));
  }

  private async refreshInner(manual: boolean): Promise<void> {
    const nowMs = this.now().getTime();
    if (!manual && this.lastRefreshMs && nowMs - this.lastRefreshMs < MIN_GAP_MS) return;
    if (manual && this.lastRefreshMs && nowMs - this.lastRefreshMs < MIN_GAP_MS) return;
    this.lastRefreshMs = nowMs;
    const now = this.now();
    const origin = this.origin();
    const credential = this.credential();
    try {
      const providers = await this.getJson(`${origin}/api/providers`, credential);
      if (providers.status === 401 || providers.status === 403) {
        this.mark("needs_token", now, "OmniRoute từ chối quyền đọc quota.");
        this.deps.logger?.warn?.({ status: providers.status }, "omniroute quota needs token");
        return;
      }
      if (providers.status < 200 || providers.status >= 300) {
        this.mark("unreachable", now, `OmniRoute trả về HTTP ${providers.status}.`);
        this.deps.logger?.warn?.({ status: providers.status }, "omniroute quota providers failed");
        return;
      }
      const connections = parseConnections(providers.body);
      let unauthorized = false;
      for (const connection of connections) {
        const outcome = await this.syncConnection(origin, credential, connection, now);
        if (outcome === "unauthorized") unauthorized = true;
      }
      await this.syncRateLimits(origin, credential, connections.map((item) => item.id));
      if (unauthorized) {
        this.mark("needs_token", now, "OmniRoute từ chối quyền đọc quota.");
        return;
      }
      this.mark("connected", now, null);
      this.deps.logger?.info?.({ connections: connections.length }, "omniroute quota synced");
    } catch (error) {
      const message = this.redact(error instanceof Error ? error.message : "Không kết nối được OmniRoute.");
      this.mark("unreachable", now, message.slice(0, 240));
      this.deps.logger?.warn?.({ code: "unreachable" }, "omniroute quota unreachable");
    }
  }

  private mark(status: "connected" | "needs_token" | "unreachable", now: Date, message: string | null): void {
    writeSyncState(this.deps.sqlite, {
      status,
      fetchedAt: now.toISOString(),
      message,
      dashboardUrl: this.origin(),
    }, now);
  }

  private async syncConnection(
    origin: string,
    credential: string | null,
    connection: ParsedConnection,
    now: Date,
  ): Promise<"ok" | "unauthorized"> {
    const fetchedAt = now.toISOString();
    try {
      const response = await this.getJson(`${origin}/api/usage/${encodeURIComponent(connection.id)}`, credential);
      if (response.status === 401 || response.status === 403) {
        keepConnectionError(this.deps.sqlite, {
          connectionId: connection.id,
          omnirouteProvider: connection.provider,
          label: connection.label,
          maskedAccount: connection.maskedAccount,
          active: connection.active,
          error: "Không đọc được quota. Cần token quản trị OmniRoute.",
          fetchedAt,
        });
        this.deps.logger?.warn?.({ status: response.status, connectionId: connection.id }, "omniroute usage unauthorized");
        return "unauthorized";
      }
      if (response.status < 200 || response.status >= 300) {
        keepConnectionError(this.deps.sqlite, {
          connectionId: connection.id,
          omnirouteProvider: connection.provider,
          label: connection.label,
          maskedAccount: connection.maskedAccount,
          active: connection.active,
          error: `Không đọc được quota (HTTP ${response.status}).`,
          fetchedAt,
        });
        return "ok";
      }
      const parsed = parseOmnirouteUsage(response.body);
      if (parsed.kind === "message") {
        replaceConnectionSnapshots(this.deps.sqlite, [{
          ...blank(connection, fetchedAt),
          quotaKey: NONE_QUOTA_KEY,
          error: null,
        }]);
        return "ok";
      }
      replaceConnectionSnapshots(this.deps.sqlite, parsed.quotas.map((quota): QuotaSnapshot => ({
        connectionId: connection.id,
        omnirouteProvider: connection.provider,
        label: connection.label,
        maskedAccount: connection.maskedAccount,
        quotaKey: quota.key,
        used: quota.used,
        total: quota.total,
        remaining: quota.remaining,
        remainingPct: quota.remainingPct,
        resetAt: quota.resetAt,
        unlimited: quota.unlimited,
        fractionReported: quota.fractionReported,
        unit: quota.unit,
        expiresAt: quota.expiresAt,
        fetchedAt,
        error: null,
        active: connection.active,
        rateLimitNote: null,
      })));
      return "ok";
    } catch (error) {
      keepConnectionError(this.deps.sqlite, {
        connectionId: connection.id,
        omnirouteProvider: connection.provider,
        label: connection.label,
        maskedAccount: connection.maskedAccount,
        active: connection.active,
        error: this.redact(error instanceof Error ? error.message : "Lỗi khi đọc quota.").slice(0, 240),
        fetchedAt,
      });
      return "ok";
    }
  }

  private async syncRateLimits(origin: string, credential: string | null, connectionIds: string[]): Promise<void> {
    try {
      const response = await this.getJson(`${origin}/api/rate-limits`, credential);
      if (response.status < 200 || response.status >= 300) return;
      for (const connectionId of connectionIds) {
        const note = summarizeRateLimit(response.body, connectionId);
        if (note) setRateLimitNotes(this.deps.sqlite, connectionId, note);
      }
    } catch {
      // Rate limits are optional.
    }
  }

  private async getJson(url: string, credential: string | null): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (credential) headers.authorization = `Bearer ${credential}`;
    const response = await (this.deps.fetchImpl ?? fetch)(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!text) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      return { status: response.status, body: null };
    }
  }
}

type ParsedConnection = {
  id: string;
  provider: string;
  label: string;
  maskedAccount: string | null;
  active: boolean;
};

function parseConnections(body: unknown): ParsedConnection[] {
  const root = z.object({
    connections: z.array(z.unknown()).optional(),
  }).passthrough().safeParse(body);
  const list = root.success && root.data.connections
    ? root.data.connections
    : Array.isArray(body) ? body : [];
  const connections: ParsedConnection[] = [];
  for (const item of list) {
    const parsed = connectionSchema.safeParse(item);
    if (!parsed.success) continue;
    const record = parsed.data as Record<string, unknown>;
    const email = firstEmail(record);
    const rawLabel = parsed.data.name || parsed.data.label || parsed.data.provider;
    connections.push({
      id: parsed.data.id,
      provider: parsed.data.provider,
      label: maskEmailsInText(rawLabel).slice(0, 120),
      maskedAccount: email ? maskEmail(email) : null,
      active: parsed.data.isActive ?? parsed.data.active ?? true,
    });
  }
  return connections;
}

function firstEmail(record: Record<string, unknown>): string | undefined {
  for (const key of ["email", "accountEmail", "userEmail"]) {
    const value = record[key];
    if (typeof value === "string" && value.includes("@")) return value;
  }
  return undefined;
}

function blank(connection: ParsedConnection, fetchedAt: string): QuotaSnapshot {
  return {
    connectionId: connection.id,
    omnirouteProvider: connection.provider,
    label: connection.label,
    maskedAccount: connection.maskedAccount,
    quotaKey: NONE_QUOTA_KEY,
    used: null,
    total: null,
    remaining: null,
    remainingPct: null,
    resetAt: null,
    unlimited: false,
    fractionReported: null,
    unit: "requests",
    expiresAt: null,
    fetchedAt,
    error: null,
    active: connection.active,
    rateLimitNote: null,
  };
}
