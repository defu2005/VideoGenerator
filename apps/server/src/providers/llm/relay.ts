import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { IncomingHttpHeaders } from "node:http";
import type Database from "better-sqlite3";
import {
  LlmRelayGrantSchema,
  relayCallerLabel,
  type JobUsage,
  type LlmRelayCallerUsage,
  type LlmRelayCode,
  type LlmRelayGrant,
  type LlmRelayGrantPatch,
  type LlmRelayStatus,
  type OmniRouteModelInfo,
  localDateKey,
  zonedLocalToUtc,
} from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { apiKeyWorkspace } from "../../auth/keyWorkspace.js";
import { defaultWorkspaceId, membershipsOf } from "../../auth/workspaces.js";
import { writeAudit } from "../../auth/auditLog.js";
import { getKeyProfile } from "../../supervision/identity.js";
import { getLlmGatewaySettings } from "./gatewaySettings.js";
import { omniRouteBaseUrl, type OmniRouteCatalogService } from "./omnirouteCatalog.js";
import { getLlmPrice, type ModelPrice } from "./pricing.js";
import type { LlmQuotaController } from "./quota.js";
import { estimateTokens } from "./tokenEstimate.js";
import { LlmError } from "./types.js";
import { RelayStreamRedactor } from "./relayStream.js";

/*
 * TASK-136: the LLM relay. Every machine except the control server reaches the LLM through here.
 * The server's OmniRoute key is attached on the way out and never leaves this file: not in a response,
 * a log, an audit row or a usage row. The policy shape (model list, rpm/tpm, daily budget per caller)
 * follows LiteLLM's "virtual key" idea; no code is copied.
 */

export const RELAY_PROVIDER = "omniroute";
export const DEFAULT_RELAY_GRANT = { models: [] as string[], rpm: 30, tpm: 200_000, dailyUsdCap: 2, enabled: true };
const WINDOW_MS = 60_000;

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: LlmRelayCode | "RELAY_UNAUTHORIZED" | "RELAY_CALLER_NOT_ALLOWED" | "RELAY_BAD_REQUEST",
    message: string,
    readonly retryAfterSec?: number,
  ) { super(message); }
}

export type RelayCaller = { caller: string; workspaceId: string | null; label: string; nodeId?: string; instance?: string };

export type RelayResult = {
  status: number;
  contentType: string;
  /** A JSON string for plain answers; a stream for `stream: true`. */
  body: string | Readable;
  headers: Record<string, string>;
};

export type RelayPath = "chat/completions" | "embeddings";

type GrantRow = { caller: string; workspace_id: string | null; models: string; rpm: number; tpm: number; daily_usd_cap: number; enabled: number; updated_at: string };
type WindowEntry = { at: number; tokens: number; requestId: string; price: ModelPrice | undefined; reservedCost: number | null; inputBound: number; outputBound: number; finished?: boolean };
type Usage = { input: number; output: number; estimated: boolean };

function reportedUsage(value: unknown): { input: number; output: number } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.prompt_tokens === undefined && raw.completion_tokens === undefined) return null;
  const input = raw.prompt_tokens ?? 0, output = raw.completion_tokens ?? 0;
  return typeof input === "number" && typeof output === "number" && Number.isSafeInteger(input) && Number.isSafeInteger(output)
    && input >= 0 && output >= 0 ? { input, output } : null;
}

export type RelayDeps = {
  sqlite: Database.Database;
  config: Pick<AppConfig, "OMNIROUTE_API_KEY" | "OMNIROUTE_BASE_URL" | "OMNIROUTE_MODEL" | "LLM_PRICES_JSON" | "LLM_TIMEOUT_MS">;
  catalog: OmniRouteCatalogService;
  quota: () => LlmQuotaController | null;
  verifyApiKey: (key: string) => Promise<{ valid: boolean; keyId?: string | undefined; userId?: string | undefined }>;
  authenticateNode: (bearer: string) => { id: string; name: string; workspace_id?: string | null } | undefined;
  /** The pipeline's own additive job-usage writer, so the finance and usage pages count a relayed call once. */
  recordJobUsage?: (jobId: string, usage: Partial<JobUsage>) => void;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function secretsOf(deps: RelayDeps): string[] {
  return [deps.config.OMNIROUTE_API_KEY].filter((value): value is string => Boolean(value && value.length >= 6));
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[đã ẩn]");
  return out;
}

function bearerOf(headers: IncomingHttpHeaders): string | undefined {
  const auth = headers.authorization;
  const bearer = typeof auth === "string" ? /^Bearer\s+(\S+)$/i.exec(auth)?.[1] : undefined;
  if (bearer) return bearer;
  const key = headers["x-api-key"];
  const value = Array.isArray(key) ? key[0] : key;
  return value?.trim() || undefined;
}

function rowToGrant(row: GrantRow): LlmRelayGrant {
  let models: string[] = [];
  try { const parsed: unknown = JSON.parse(row.models); if (Array.isArray(parsed)) models = parsed.filter((item): item is string => typeof item === "string"); } catch { /* keep empty */ }
  return {
    caller: row.caller, workspaceId: row.workspace_id, models, rpm: row.rpm, tpm: row.tpm,
    dailyUsdCap: row.daily_usd_cap, enabled: row.enabled === 1, updatedAt: row.updated_at,
  };
}

export function modelAllowed(allowed: readonly string[], model: string): boolean {
  if (!allowed.length) return true;
  return allowed.some((entry) => entry === model || (entry.endsWith("*") && model.startsWith(entry.slice(0, -1))));
}

export class LlmRelay {
  private readonly windows = new Map<string, WindowEntry[]>();
  private readonly pendingFinishes: Array<{
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    estimated: boolean;
    status: "ok" | "error";
    code: string | null;
    latencyMs: number;
    requestId: string;
    free?: boolean;
    model: string;
    jobId: string | null;
    rc: RelayCaller;
    cost: number;
  }> = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: RelayDeps) {
    const wrapped = this.sqlite as Partial<import("../../db/stats.js").WrappedDatabase>;
    if (wrapped.profiler && typeof wrapped.profiler.registerFlusher === "function") {
      wrapped.profiler.registerFlusher("llm_relay_usage", () => this.flush());
    }
  }

  private now(): Date { return (this.deps.now ?? (() => new Date()))(); }
  private get fetchImpl(): typeof fetch { return this.deps.fetchImpl ?? fetch; }
  private get sqlite(): Database.Database { return this.deps.sqlite; }
  private publicValue(value: string): boolean { return redactSecrets(value, secretsOf(this.deps)) === value; }
  private publicGrant(grant: LlmRelayGrant): LlmRelayGrant {
    if (this.publicValue(grant.caller) && grant.models.every((model) => this.publicValue(model))) return grant;
    return { ...grant, caller: redactSecrets(grant.caller, secretsOf(this.deps)), models: [], enabled: false };
  }

  // ---------- identity ----------

  async authenticate(headers: IncomingHttpHeaders): Promise<RelayCaller> {
    const token = bearerOf(headers);
    if (!token) {
      if (headers.cookie) throw new RelayError(403, "RELAY_CALLER_NOT_ALLOWED", "Phiên trình duyệt không dùng được cổng LLM. Dùng khoá agent hoặc token máy worker.");
      throw new RelayError(401, "RELAY_UNAUTHORIZED", "Thiếu khoá agent hoặc token máy worker.");
    }
    if (token.startsWith("vgn_")) {
      const node = this.deps.authenticateNode(token);
      if (!node) throw new RelayError(403, "RELAY_CALLER_NOT_ALLOWED", "Token máy worker không hợp lệ hoặc đã bị thu hồi.");
      const caller = `node:${node.id}`;
      if (!this.publicValue(caller)) throw new RelayError(403, "RELAY_CALLER_NOT_ALLOWED", "Định danh máy chứa dữ liệu nhạy cảm.");
      return { caller, workspaceId: node.workspace_id ?? defaultWorkspaceId(this.sqlite), label: `Máy ${node.name}`, nodeId: node.id };
    }
    let verified: { valid: boolean; keyId?: string | undefined; userId?: string | undefined };
    try { verified = await this.deps.verifyApiKey(token); } catch { verified = { valid: false }; }
    if (!verified.valid || !verified.keyId) throw new RelayError(401, "RELAY_UNAUTHORIZED", "Khoá API không hợp lệ.");
    const profile = getKeyProfile(this.sqlite, verified.keyId);
    if (!profile) throw new RelayError(403, "RELAY_CALLER_NOT_ALLOWED", "Khoá này chưa gắn hồ sơ agent nên không dùng được cổng LLM.");
    const stored = this.sqlite.prepare("SELECT metadata,reference_id FROM apikey WHERE id=?").get(verified.keyId) as { metadata: string | null; reference_id: string } | undefined;
    const userId = verified.userId ?? stored?.reference_id;
    const memberships = userId ? membershipsOf(this.sqlite, userId) : [];
    const workspaceId = apiKeyWorkspace(stored?.metadata) ?? memberships[0]?.workspaceId;
    const requested = headers["x-workspace-id"];
    if (!stored || !workspaceId || !memberships.some((membership) => membership.workspaceId === workspaceId)
      || (requested !== undefined && (typeof requested !== "string" || requested.trim() !== workspaceId))) {
      throw new RelayError(403, "RELAY_CALLER_NOT_ALLOWED", "Khoá máy không còn quyền trong workspace đã gắn hoặc yêu cầu sai workspace.");
    }
    const instance = `${profile.agentKind}/${profile.instanceName}`;
    if (!this.publicValue(instance)) throw new RelayError(403, "RELAY_CALLER_NOT_ALLOWED", "Định danh agent chứa dữ liệu nhạy cảm.");
    return { caller: `agent:${instance}`, workspaceId, label: `Agent ${instance}`, instance };
  }

  // ---------- grants ----------

  private rowOf(caller: string, workspaceId: string | null): LlmRelayGrant | null {
    const row = this.sqlite.prepare("SELECT * FROM llm_relay_grants WHERE caller = ? AND workspace_id IS ?").get(caller, workspaceId) as GrantRow | undefined;
    return row ? this.publicGrant(rowToGrant(row)) : null;
  }

  defaultGrant(workspaceId: string | null = null): LlmRelayGrant {
    return this.rowOf("*", workspaceId) ?? { caller: "*", workspaceId, ...DEFAULT_RELAY_GRANT, updatedAt: "" };
  }

  /** The grant that applies to a caller. An empty model list falls back to the default row's list. */
  grantOf(caller: string, workspaceId: string | null = null): LlmRelayGrant {
    const base = this.defaultGrant(workspaceId);
    const own = caller === "*" ? null : this.rowOf(caller, workspaceId);
    if (!own) return { ...base, caller };
    return { ...own, models: own.models.length ? own.models : base.models };
  }

  saveGrant(caller: string, patch: LlmRelayGrantPatch, workspaceId: string | null = null): LlmRelayGrant {
    if (!this.publicValue(caller) || patch.models?.some((model) => !this.publicValue(model))) {
      throw new RelayError(400, "RELAY_BAD_REQUEST", "Tên máy hoặc model có dữ liệu nhạy cảm, không được lưu vào cấu hình relay.");
    }
    const current = this.rowOf(caller, workspaceId) ?? { ...(caller === "*" ? this.defaultGrant(workspaceId) : { ...this.defaultGrant(workspaceId), models: [] }), caller };
    const next = LlmRelayGrantSchema.parse({
      ...current, ...patch, caller, workspaceId, updatedAt: this.now().toISOString(),
    });
    this.sqlite.prepare(
      `INSERT INTO llm_relay_grants (caller, workspace_id, models, rpm, tpm, daily_usd_cap, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET models=excluded.models, rpm=excluded.rpm,
         tpm=excluded.tpm, daily_usd_cap=excluded.daily_usd_cap, enabled=excluded.enabled, updated_at=excluded.updated_at`,
    ).run(next.caller, next.workspaceId, JSON.stringify(next.models), next.rpm, next.tpm, next.dailyUsdCap, next.enabled ? 1 : 0, next.updatedAt);
    return next;
  }

  deleteGrant(caller: string, workspaceId: string | null = null): boolean {
    if (caller === "*") return false;
    return this.sqlite.prepare("DELETE FROM llm_relay_grants WHERE caller = ? AND workspace_id IS ?").run(caller, workspaceId).changes > 0;
  }

  /** The model a caller gets by default: the first allowed one, else the server's own default. */
  defaultModelFor(caller: string, workspaceId: string | null = null): string {
    const grant = this.grantOf(caller, workspaceId);
    const exact = grant.models.find((model) => !model.endsWith("*"));
    if (exact) return exact;
    return [this.deps.config.OMNIROUTE_MODEL, ...this.deps.catalog.peekModels().map((model) => model.id)]
      .find((model): model is string => Boolean(model && this.publicValue(model) && modelAllowed(grant.models, model))) ?? "";
  }

  // ---------- availability and models ----------

  private async ensureAvailable(): Promise<OmniRouteModelInfo[]> {
    const down = new RelayError(503, "LLM_RELAY_UNAVAILABLE", "Cổng LLM của máy chủ chưa sẵn sàng: OmniRoute chưa được cấu hình hoặc không phản hồi. Thử lại sau.");
    if (!this.deps.config.OMNIROUTE_API_KEY) throw down;
    try {
      return await this.deps.catalog.getModels();
    } catch {
      throw down;
    }
  }

  async listModels(rc: RelayCaller): Promise<{ object: "list"; data: Array<{ id: string; object: "model"; owned_by: string }> }> {
    await this.ensureAvailable();
    const grant = this.grantOf(rc.caller, rc.workspaceId);
    if (!grant.enabled) throw this.refuse(rc, "", new RelayError(403, "RELAY_DISABLED", "Máy này đã bị tắt quyền dùng LLM qua máy chủ."));
    const models = await this.deps.catalog.getModels();
    return {
      object: "list",
      data: models.filter((model) => this.publicValue(model.id) && this.publicValue(model.ownedBy) && modelAllowed(grant.models, model.id))
        .map((model) => ({ id: model.id, object: "model" as const, owned_by: model.ownedBy })),
    };
  }

  // ---------- policy ----------

  private windowOf(caller: string, workspaceId: string | null): WindowEntry[] {
    const key = JSON.stringify([workspaceId, caller]);
    const cutoff = this.now().getTime() - WINDOW_MS;
    const fresh = (this.windows.get(key) ?? []).filter((entry) => entry.at > cutoff);
    this.windows.set(key, fresh);
    return fresh;
  }

  private startOfDay(): string {
    const zone = this.deps.quota()?.policyFor(null).timeZone ?? "UTC";
    return zonedLocalToUtc(localDateKey(this.now(), zone), "00:00", zone).toISOString();
  }

  spentToday(caller: string, workspaceId: string | null = null): number {
    this.flush();
    const row = this.sqlite.prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_relay_usage WHERE caller = ? AND workspace_id IS ? AND created_at >= ? AND status != 'refused'",
    ).get(caller, workspaceId, this.startOfDay()) as { usd: number };
    return row.usd;
  }

  private preflight(rc: RelayCaller, grant: LlmRelayGrant, model: string, inputTokens: number, outputTokens: number, jobId: string | null): WindowEntry {
    return this.sqlite.transaction(() => {
    if (!grant.enabled) throw new RelayError(403, "RELAY_DISABLED", "Máy này đã bị tắt quyền dùng LLM qua máy chủ.");
    if (!modelAllowed(grant.models, model)) {
      throw new RelayError(403, "RELAY_MODEL_NOT_ALLOWED", `Model "${model}" không nằm trong danh sách được phép của máy này. Lấy danh sách từ GET /models.`);
    }
    const window = this.windowOf(rc.caller, rc.workspaceId);
    const nowMs = this.now().getTime();
    const oldest = window[0];
    const retryIn = (): number => Math.max(1, Math.ceil(((oldest?.at ?? nowMs) + WINDOW_MS - nowMs) / 1000));
    if (window.length >= grant.rpm) {
      throw new RelayError(429, "RELAY_RATE_LIMITED", `Vượt ${grant.rpm} yêu cầu mỗi phút. Thử lại sau ${retryIn()} giây.`, retryIn());
    }
    const usedTokens = window.reduce((sum, entry) => sum + entry.tokens, 0);
    if (usedTokens + inputTokens + outputTokens > grant.tpm) {
      throw new RelayError(429, "RELAY_RATE_LIMITED", `Vượt ${grant.tpm} token mỗi phút. Thử lại sau ${retryIn()} giây.`, retryIn());
    }
    const price = getLlmPrice(this.deps.config, RELAY_PROVIDER, model);
    const reservedCost = price ? (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000 : null;
    const unknown = this.sqlite.prepare(`SELECT 1 FROM llm_relay_usage WHERE caller=? AND workspace_id IS ?
      AND created_at>=? AND status IN ('pending','ok','error') AND cost_usd IS NULL LIMIT 1`).get(rc.caller, rc.workspaceId, this.startOfDay());
    if (grant.dailyUsdCap > 0 && (reservedCost === null || unknown)) {
      throw new RelayError(429, "RELAY_BUDGET_EXCEEDED", "Chưa xác định được giá model hoặc còn chi phí chưa rõ hôm nay, nên không thể bảo đảm trần USD của máy.");
    }
    if (grant.dailyUsdCap > 0 && (reservedCost === null || this.spentToday(rc.caller, rc.workspaceId) + reservedCost > grant.dailyUsdCap)) {
      throw new RelayError(429, "RELAY_BUDGET_EXCEEDED", `Máy này đã dùng hết hạn mức ${grant.dailyUsdCap} USD hôm nay.`);
    }
    const quota = this.deps.quota();
    if (quota) {
      if (quota.isUnavailable(RELAY_PROVIDER, model)) {
        const until = quota.earliestRetryAt([{ provider: RELAY_PROVIDER, model }]);
        const wait = until ? Math.max(1, Math.ceil((Date.parse(until) - nowMs) / 1000)) : 60;
        throw new RelayError(429, "RELAY_RATE_LIMITED", `Model "${model}" đang nghỉ vì hết hạn mức phía nhà cung cấp. Thử lại sau ${wait} giây.`, wait);
      }
      if (quota.kindOf(RELAY_PROVIDER, model) === "paid") {
        const { paidFallbackDailyUsd } = quota.policyFor(null);
        const held = (this.sqlite.prepare("SELECT COALESCE(SUM(cost_usd),0) AS usd FROM llm_relay_usage WHERE status='pending'").get() as { usd: number }).usd;
        const unknownPaidCost = this.sqlite.prepare(`SELECT 1 FROM llm_relay_usage WHERE created_at>=?
          AND status IN ('pending','ok','error') AND cost_usd IS NULL LIMIT 1`).get(this.startOfDay());
        if (paidFallbackDailyUsd > 0 && (reservedCost === null || unknownPaidCost || quota.todaySpendUsd(this.now()) + held + reservedCost > paidFallbackDailyUsd)) {
          throw new RelayError(429, "RELAY_BUDGET_EXCEEDED", "Ngân sách chi trả phí hôm nay của workspace đã hết.");
        }
      }
    }
    const entry: WindowEntry = { at: nowMs, tokens: inputTokens + outputTokens, requestId: randomUUID(), price, reservedCost, inputBound: inputTokens, outputBound: outputTokens };
    this.sqlite.prepare(`INSERT INTO llm_relay_usage(id,caller,workspace_id,model,job_id,input_tokens,output_tokens,cost_usd,estimated,status,latency_ms,created_at)
      VALUES (?,?,?,?,?,?,?,?,1,'pending',0,?)`).run(entry.requestId, rc.caller, rc.workspaceId, model, jobId, inputTokens, outputTokens, reservedCost, this.now().toISOString());
    window.push(entry);
    return entry;
    }).immediate();
  }

  /** Remember a refusal for the fleet pages, then hand the error back to throw. */
  private refuse(rc: RelayCaller, model: string, error: RelayError): RelayError {
    this.sqlite.prepare(
      `INSERT INTO llm_relay_usage (id, caller, workspace_id, model, job_id, input_tokens, output_tokens, cost_usd, estimated, status, code, latency_ms, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, 0, NULL, 0, 'refused', ?, 0, ?)`,
    ).run(randomUUID(), rc.caller, rc.workspaceId, model || "-", error.code, this.now().toISOString());
    return error;
  }

  // ---------- jobs ----------

  /** A job id counts only when it is leased to this very caller. */
  private ownJob(rc: RelayCaller, jobId: string | undefined): string | null {
    if (!jobId || jobId.length > 80) return null;
    const job = this.sqlite.prepare(`SELECT j.id,j.project_id,j.node_id,j.status,j.lease_until,p.workspace_id
      FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?`).get(jobId) as
      { id: string; project_id: string; node_id: string | null; status: string; lease_until: string | null; workspace_id: string | null } | undefined;
    if (!job || job.status !== "RUNNING" || (job.workspace_id ?? defaultWorkspaceId(this.sqlite)) !== rc.workspaceId) return null;
    const nowIso = this.now().toISOString();
    if (rc.nodeId) return job.node_id === rc.nodeId && job.lease_until && job.lease_until > nowIso ? job.id : null;
    if (!rc.instance) return null;
    const lease = this.sqlite.prepare(
      `SELECT 1 AS ok FROM agent_leases WHERE holder_instance=? AND expires_at>? AND preempted_by IS NULL
       AND ((resource_kind='job' AND resource_id=?) OR (resource_kind='project' AND resource_id=?)) LIMIT 1`,
    ).get(rc.instance, nowIso, job.id, job.project_id ?? "") as { ok: number } | undefined;
    return lease ? job.id : null;
  }

  // ---------- forwarding ----------

  async relay(path: RelayPath, rc: RelayCaller, input: unknown, options: { jobId?: string | undefined; signal?: AbortSignal | undefined } = {}): Promise<RelayResult> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new RelayError(400, "RELAY_BAD_REQUEST", "Nội dung yêu cầu phải là JSON object.");
    const body = { ...(input as Record<string, unknown>) };
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) throw new RelayError(400, "RELAY_BAD_REQUEST", "Thiếu trường model.");
    if (!this.publicValue(model)) throw new RelayError(400, "RELAY_BAD_REQUEST", "Tên model có dữ liệu nhạy cảm.");
    const catalog = await this.ensureAvailable();
    const grant = this.grantOf(rc.caller, rc.workspaceId);
    const estimatedInput = estimateTokens(JSON.stringify(body.messages ?? body.input ?? ""), true);
    let inputBound = Buffer.byteLength(JSON.stringify(body))
      + (path === "chat/completions" ? 64 + (Array.isArray(body.messages) ? body.messages.length * 16 : 0) : 0);
    const containsImage = (value: unknown): boolean => Array.isArray(value) ? value.some(containsImage)
      : value !== null && typeof value === "object" && (Object.hasOwn(value, "image_url")
        || ["image", "input_image"].includes(String((value as Record<string, unknown>).type))
        || Object.values(value).some(containsImage));
    if (containsImage(body)) {
      const contextWindow = catalog.find((candidate) => candidate.id === model)?.contextWindow;
      if (!contextWindow || !Number.isSafeInteger(contextWindow)) {
        throw new RelayError(400, "RELAY_BAD_REQUEST", "Model chưa có giới hạn ngữ cảnh để dự trữ token ảnh. Chọn model có thông tin ngữ cảnh trên máy chủ.");
      }
      inputBound = Math.max(inputBound, contextWindow);
    }
    let outputBound = 0;
    if (path === "chat/completions") {
      const count = body.n ?? 1;
      const requested = body.max_completion_tokens ?? body.max_tokens ?? Math.max(1, Math.min(4096, grant.tpm - inputBound));
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 128
        || typeof requested !== "number" || !Number.isSafeInteger(requested) || requested < 1
        || (body.max_completion_tokens !== undefined && body.max_tokens !== undefined)) {
        throw new RelayError(400, "RELAY_BAD_REQUEST", "Giới hạn token đầu ra và số kết quả phải là số nguyên dương; chỉ dùng một trường giới hạn token.");
      }
      if (body.max_completion_tokens === undefined && body.max_tokens === undefined) body.max_tokens = requested;
      outputBound = requested * count;
    }
    const jobId = this.ownJob(rc, options.jobId);
    let entry: WindowEntry;
    try {
      entry = this.preflight(rc, grant, model, inputBound, outputBound, jobId);
    } catch (error) {
      if (error instanceof RelayError) throw this.refuse(rc, model, error);
      throw error;
    }
    const stream = path === "chat/completions" && body.stream === true;
    if (stream) {
      const previous = typeof body.stream_options === "object" && body.stream_options ? body.stream_options as Record<string, unknown> : {};
      body.stream_options = { ...previous, include_usage: true };
    }
    const started = Date.now();
    const controller = new AbortController();
    const upstreamSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.deps.config.LLM_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]);
    const base = omniRouteBaseUrl(this.deps.config).replace(/\/+$/, "");
    let upstream: Response;
    try {
      upstream = await this.fetchImpl(`${base}/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: stream ? "text/event-stream" : "application/json",
          authorization: `Bearer ${this.deps.config.OMNIROUTE_API_KEY ?? ""}`,
        },
        body: JSON.stringify(body),
        signal: upstreamSignal,
      });
    } catch {
      this.finish({ rc, model, jobId, usage: { input: estimatedInput, output: 0, estimated: true }, status: "error", code: "LLM_RELAY_UNAVAILABLE", started, entry });
      throw new RelayError(503, "LLM_RELAY_UNAVAILABLE", "Không kết nối được OmniRoute trên máy chủ. Thử lại sau.");
    }
    const secrets = secretsOf(this.deps);
    const contentType = /(?:^|\/)\w*(?:\+)?json(?:;|$)/i.test(upstream.headers.get("content-type") ?? "application/json")
      ? "application/json" : "text/plain; charset=utf-8";

    if (!upstream.ok) {
      const text = redactSecrets(await upstream.text().catch(() => ""), secrets);
      if (upstream.status === 429) this.coolModel(model, text, upstream.headers.get("retry-after"));
      this.finish({ rc, model, jobId, usage: { input: 0, output: 0, estimated: true }, status: "error", code: `UPSTREAM_${upstream.status}`, started, entry, free: true });
      const headers: Record<string, string> = {};
      const retry = upstream.headers.get("retry-after");
      if (retry && this.publicValue(retry) && (/^\d{1,10}$/.test(retry) || Number.isFinite(Date.parse(retry)))) headers["retry-after"] = retry;
      return { status: upstream.status, contentType, body: text, headers };
    }

    if (!stream || !upstream.body) {
      let text: string;
      try { text = redactSecrets(await upstream.text(), secrets); }
      catch {
        this.finish({ rc, model, jobId, usage: { input: estimatedInput, output: 0, estimated: true }, status: "error", code: "LLM_RELAY_BODY", started, entry });
        throw new RelayError(502, "LLM_RELAY_UNAVAILABLE", "Không đọc được phản hồi LLM. Lần gọi đã được ghi nhận với số liệu ước tính.");
      }
      this.finish({ rc, model, jobId, usage: this.usageFromJson(text, estimatedInput), status: "ok", code: null, started, entry });
      return { status: upstream.status, contentType, body: text, headers: {} };
    }

    const self = this;
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const redactor = new RelayStreamRedactor(secrets);
    let usage: { input: number; output: number } | null = null;
    let produced = "";
    let completed = false;
    const finishStream = () => self.finish({
      rc, model, jobId, started, entry,
      usage: usage ? { ...usage, estimated: false } : { input: estimatedInput, output: estimateTokens(produced), estimated: true },
      status: completed ? "ok" : "error", code: completed ? null : "LLM_RELAY_STREAM",
    });
    async function* pump(): AsyncGenerator<Buffer> {
      let pending = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          const text = redactor.push(done ? decoder.decode() : decoder.decode(value, { stream: true }), done);
          pending += text;
          let newline = pending.indexOf("\n");
          while (newline >= 0) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            const parsed = line.startsWith("data:") ? self.parseSseLine(line.slice(5).trim()) : null;
            if (parsed?.usage) usage = parsed.usage;
            if (parsed?.text) produced += parsed.text;
            newline = pending.indexOf("\n");
          }
          if (text) yield Buffer.from(text);
          if (done) { completed = true; break; }
        }
      } catch {
        throw new RelayError(502, "LLM_RELAY_UNAVAILABLE", "Luồng phản hồi LLM bị ngắt. Số liệu đã nhận vẫn được tính cho lần gọi này.");
      } finally {
        controller.abort();
        reader.cancel().catch(() => undefined);
        finishStream();
      }
    }
    const output = Readable.from(pump());
    const abortOutput = () => {
      if (!completed && !entry.finished) output.destroy(new RelayError(502, "LLM_RELAY_UNAVAILABLE", "Lần gọi LLM đã hết thời gian chờ hoặc bị hủy."));
    };
    output.on("error", () => undefined); // The consumer still receives the error; also safe before a consumer attaches.
    upstreamSignal.addEventListener("abort", abortOutput, { once: true });
    output.once("close", () => {
      upstreamSignal.removeEventListener("abort", abortOutput);
      controller.abort();
      reader.cancel().catch(() => undefined);
      finishStream();
    });
    if (upstreamSignal.aborted) abortOutput();
    return { status: upstream.status, contentType: "text/event-stream; charset=utf-8", body: output, headers: { "cache-control": "no-cache" } };
  }

  private parseSseLine(data: string): { usage?: { input: number; output: number }; text?: string } | null {
    if (!data || data === "[DONE]") return null;
    try {
      const chunk = JSON.parse(data) as { usage?: unknown; choices?: Array<{ delta?: { content?: unknown } }> };
      const out: { usage?: { input: number; output: number }; text?: string } = {};
      const usage = reportedUsage(chunk.usage);
      if (usage) out.usage = usage;
      out.text = chunk.choices?.flatMap((choice) => typeof choice.delta?.content === "string" ? [choice.delta.content] : []).join("");
      return out;
    } catch {
      return null;
    }
  }

  private usageFromJson(text: string, estimatedInput: number): Usage {
    try {
      const parsed = JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; choices?: Array<{ message?: { content?: unknown } }> };
      const usage = reportedUsage(parsed.usage);
      if (usage) return { ...usage, estimated: false };
      const content = parsed.choices?.[0]?.message?.content;
      return { input: estimatedInput, output: estimateTokens(typeof content === "string" ? content : ""), estimated: true };
    } catch {
      return { input: estimatedInput, output: 0, estimated: true };
    }
  }

  /** An upstream 429 cools the model for every caller, local pipeline included. */
  private coolModel(model: string, text: string, retryAfter: string | null): void {
    const quota = this.deps.quota();
    if (!quota) return;
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    quota.onQuotaFailure({
      provider: RELAY_PROVIDER, model, now: this.now(),
      error: new LlmError(text.slice(0, 300) || "429", "LLM_RATE_LIMIT", true, 429, undefined, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined),
    });
  }

  private ensureFlushTimer(): void {
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        try {
          this.flush();
        } catch {
          // ignore flush error in background tick
        }
      }, 1000);
      if (typeof this.flushTimer.unref === "function") {
        this.flushTimer.unref();
      }
    }
  }

  getPendingFinishesCount(): number {
    return this.pendingFinishes.length;
  }

  clearPendingFinishes(): void {
    this.pendingFinishes.length = 0;
  }

  flush(): void {
    if (this.pendingFinishes.length === 0) return;
    const items = this.pendingFinishes.splice(0, this.pendingFinishes.length);
    this.writeFinishes(items);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private writeFinishes(items: typeof this.pendingFinishes): void {
    if (items.length === 0) return;
    this.sqlite.transaction(() => {
      const stmt = this.sqlite.prepare(`UPDATE llm_relay_usage SET input_tokens=?,output_tokens=?,cost_usd=?,estimated=?,status=?,code=?,latency_ms=?
        WHERE id=? AND status='pending'`);
      for (const item of items) {
        stmt.run(
          item.inputTokens,
          item.outputTokens,
          item.costUsd,
          item.estimated ? 1 : 0,
          item.status,
          item.code,
          item.latencyMs,
          item.requestId,
        );
      }
    }).immediate();
  }

  private finish(input: {
    rc: RelayCaller; model: string; jobId: string | null; usage: Usage; status: "ok" | "error"; code: string | null;
    started: number; entry: WindowEntry; free?: boolean; immediate?: boolean;
  }): void {
    if (input.entry.finished) return;
    const { rc, model, jobId, status } = input;
    const usage = !input.free && input.usage.estimated ? {
      input: Math.max(input.usage.input, input.entry.inputBound), output: Math.max(input.usage.output, input.entry.outputBound), estimated: true,
    } : input.usage;
    const price = input.entry.price;
    let cost = input.free || !price ? 0 : (usage.input * price.inputPerMTok + usage.output * price.outputPerMTok) / 1_000_000;
    // A broken body cannot prove a cheaper bill: retain the admitted upper estimate.
    if (!input.free && usage.estimated) cost = Math.max(cost, input.entry.reservedCost ?? 0);

    input.entry.tokens = usage.input + usage.output;
    input.entry.finished = true;

    if (!input.free) this.deps.quota()?.recordCall({ provider: RELAY_PROVIDER, model, inputTokens: usage.input, outputTokens: usage.output, now: this.now() });
    if (jobId && this.deps.recordJobUsage) {
      this.deps.recordJobUsage(jobId, {
        llmCalls: 1, inputTokens: usage.input, outputTokens: usage.output, costUsd: cost,
        provider: `relay:${rc.caller}`, model, ...(usage.estimated && !input.free ? { tokensUnknown: true } : {}), ...((!price || usage.estimated) && !input.free ? { costUnknown: true } : {}),
        calls: [{
          task: "relay", provider: `relay:${rc.caller}`, model, inputTokens: usage.input, outputTokens: usage.output,
          cached: false, fallback: false, ok: status === "ok", costUsd: cost,
          ...(usage.estimated && !input.free ? { tokensUnknown: true } : {}),
          ...((!price || usage.estimated) && !input.free ? { costUnknown: true } : {}),
        }],
      });
    }

    const item = {
      inputTokens: usage.input,
      outputTokens: usage.output,
      costUsd: input.free || price ? cost : null,
      estimated: Boolean(usage.estimated),
      status,
      code: input.code,
      latencyMs: Math.max(0, Date.now() - input.started),
      requestId: input.entry.requestId,
      free: input.free,
      model,
      jobId,
      rc,
      cost: cost ?? 0,
    };

    if (input.immediate) {
      this.writeFinishes([item]);
      return;
    }

    this.pendingFinishes.push(item);
    this.ensureFlushTimer();
  }

  /** Run once at control startup, before accepting requests. A lost response may already be billable. */
  recoverPending(): number {
    this.flush();
    return this.sqlite.transaction(() => {
      const rows = this.sqlite.prepare(`SELECT * FROM llm_relay_usage WHERE status='pending'`).all() as Array<{
        id: string; caller: string; workspace_id: string | null; job_id: string | null; model: string;
        input_tokens: number; output_tokens: number; cost_usd: number | null;
      }>;
      for (const row of rows) {
        this.sqlite.prepare("UPDATE llm_relay_usage SET status='error',code='RELAY_PROCESS_RESTART',estimated=1 WHERE id=? AND status='pending'").run(row.id);
        this.deps.quota()?.recordCall({ provider: RELAY_PROVIDER, model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens, now: this.now() });
        if (row.job_id && this.deps.recordJobUsage) this.deps.recordJobUsage(row.job_id, {
          llmCalls: 1, inputTokens: row.input_tokens, outputTokens: row.output_tokens, costUsd: row.cost_usd ?? 0,
          tokensUnknown: true, costUnknown: true, provider: `relay:${row.caller}`, model: row.model,
          calls: [{ task: "relay", provider: `relay:${row.caller}`, model: row.model, inputTokens: row.input_tokens,
            outputTokens: row.output_tokens, costUsd: row.cost_usd ?? 0, cached: false, fallback: false, ok: false, tokensUnknown: true, costUnknown: true }],
        });
      }
      return rows.length;
    }).immediate();
  }

  // ---------- admin views ----------

  usageSince(since: string, workspaceId: string | null = null): LlmRelayCallerUsage[] {
    this.flush();
    const rows = this.sqlite.prepare(
      `SELECT caller,
         SUM(CASE WHEN status = 'refused' THEN 0 ELSE 1 END) AS calls,
         SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) AS refused,
         COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cost_usd), 0) AS cost_usd,
         MAX(CASE WHEN status!='refused' AND (cost_usd IS NULL OR estimated=1) THEN 1 ELSE 0 END) AS cost_unknown,
         MAX(CASE WHEN status!='refused' AND estimated=1 THEN 1 ELSE 0 END) AS tokens_unknown
       FROM llm_relay_usage WHERE created_at >= ? AND workspace_id IS ? GROUP BY caller`,
    ).all(since, workspaceId) as Array<{ caller: string; calls: number; refused: number; input_tokens: number; output_tokens: number; cost_usd: number; cost_unknown: number; tokens_unknown: number }>;
    const refusals = new Map((this.sqlite.prepare(
      `SELECT caller, code, created_at FROM llm_relay_usage u WHERE status = 'refused' AND workspace_id IS ?
         AND created_at = (SELECT MAX(created_at) FROM llm_relay_usage WHERE caller = u.caller AND workspace_id IS u.workspace_id AND status = 'refused')`,
    ).all(workspaceId) as Array<{ caller: string; code: string; created_at: string }>).map((row) => [row.caller, row]));
    const grants = new Map((this.sqlite.prepare("SELECT * FROM llm_relay_grants WHERE workspace_id IS ?").all(workspaceId) as GrantRow[]).map((row) => [row.caller, this.publicGrant(rowToGrant(row))]));
    const callers = new Set<string>([...rows.map((row) => row.caller), ...grants.keys()].filter((caller) => caller !== "*"));
    const byCaller = new Map(rows.map((row) => [row.caller, row]));
    return [...callers].sort().map((caller) => {
      const row = byCaller.get(caller);
      const refusal = refusals.get(caller);
      return {
        caller: redactSecrets(caller, secretsOf(this.deps)), label: relayCallerLabel(redactSecrets(caller, secretsOf(this.deps))), calls: row?.calls ?? 0, refused: row?.refused ?? 0,
        inputTokens: row?.input_tokens ?? 0, outputTokens: row?.output_tokens ?? 0, costUsd: row?.cost_usd ?? 0,
        ...(row?.cost_unknown ? { costUnknown: true } : {}), ...(row?.tokens_unknown ? { tokensUnknown: true } : {}),
        lastRefusal: refusal?.code ?? null, lastRefusalAt: refusal?.created_at ?? null, grant: grants.get(caller) ?? null,
      };
    });
  }

  usageOf(caller: string, workspaceId: string | null = null): LlmRelayCallerUsage | null {
    return this.usageSince(this.startOfDay(), workspaceId).find((row) => row.caller === caller) ?? null;
  }

  async status(workspaceId: string | null = null): Promise<LlmRelayStatus> {
    const catalog = this.deps.catalog;
    let reachable = false;
    let lastError: string | null = null;
    let models: string[] = [];
    if (this.deps.config.OMNIROUTE_API_KEY) {
      try { models = (await catalog.getModels()).filter((model) => this.publicValue(model.id)).map((model) => model.id); reachable = true; } catch (error) {
        lastError = redactSecrets(error instanceof Error ? error.message : "Không rõ", secretsOf(this.deps)).slice(0, 200);
      }
    } else {
      lastError = "Chưa đặt OMNIROUTE_API_KEY trên máy chủ.";
    }
    return {
      configured: Boolean(this.deps.config.OMNIROUTE_API_KEY), reachable, modelCount: models.length, lastError,
      gatewayMode: getLlmGatewaySettings(this.sqlite).mode,
      defaultGrant: this.defaultGrant(workspaceId), callers: this.usageSince(this.startOfDay(), workspaceId), models: models.slice(0, 500),
    };
  }

  /** One audit row when an old `execution.lendProviders` still lists an LLM scope. */
  auditIgnoredLoan(scopes: string[]): void {
    writeAudit(this.sqlite, {
      action: "llm.lend_ignored", source: "system", outcome: "ok", targetType: "setting", targetId: "execution.lendProviders",
      summary: `Bỏ qua ${scopes.join(", ")}: khoá LLM không còn cho mượn, dùng cổng LLM qua máy chủ.`,
    });
  }
}
