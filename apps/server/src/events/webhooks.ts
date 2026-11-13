import { randomUUID } from "node:crypto";
import { stampWorkspace } from "../auth/requestContext.js";
import type Database from "better-sqlite3";
import { webhookRetryDelayMs, webhookUrlAllowed, type AgentEvent } from "@vg/shared";
import { signWebhook } from "./webhookSign.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import { createUserRequest } from "../operator/autopilot.js";

const secretKey = (id: string) => `webhook:${id}`;
let boundVault: TokenVault | null = null;

export function bindWebhookVault(vault: TokenVault): void {
  boundVault = vault;
}

export function deliverBoundWebhooks(sqlite: Database.Database): Promise<number> {
  if (!boundVault) return Promise.resolve(0);
  return deliverDueWebhooks(sqlite, boundVault);
}
const FAIL_WINDOW_MS = 3 * 24 * 60 * 60_000;

export type WebhookEndpoint = {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  allowPrivate: boolean;
  enabled: boolean;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type EndpointRow = {
  id: string; name: string; url: string; event_types: string; allow_private: number;
  enabled: number; disabled_reason: string | null; created_at: string; updated_at: string;
};

function mapEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id, name: row.name, url: row.url,
    eventTypes: JSON.parse(row.event_types) as string[],
    allowPrivate: row.allow_private === 1, enabled: row.enabled === 1,
    disabledReason: row.disabled_reason, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function listWebhookEndpoints(sqlite: Database.Database): WebhookEndpoint[] {
  const rows = sqlite.prepare("SELECT * FROM webhook_endpoints ORDER BY created_at").all() as EndpointRow[];
  return rows.map(mapEndpoint);
}

export function createWebhookEndpoint(sqlite: Database.Database, vault: TokenVault, input: {
  name: string; url: string; eventTypes: string[]; allowPrivate?: boolean;
}, now = new Date()): { endpoint: WebhookEndpoint; secret: string } {
  if (!webhookUrlAllowed(input.url, input.allowPrivate === true)) {
    throw new Error("Địa chỉ webhook không được phép.");
  }
  const id = randomUUID();
  const secret = `whsec_${Buffer.from(randomUUID()).toString("base64url")}`;
  const stamp = now.toISOString();
  sqlite.prepare(`INSERT INTO webhook_endpoints
    (id, name, url, event_types, allow_private, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(id, input.name, input.url, JSON.stringify(input.eventTypes), input.allowPrivate ? 1 : 0, stamp, stamp);
  stampWorkspace(sqlite, "webhook_endpoints", id);
  vault.storeSecret(secretKey(id), secret);
  const endpoint = listWebhookEndpoints(sqlite).find((item) => item.id === id);
  if (!endpoint) throw new Error("Không tạo được webhook.");
  return { endpoint, secret };
}

export function rotateWebhookSecret(sqlite: Database.Database, vault: TokenVault, id: string): string {
  const secret = `whsec_${Buffer.from(randomUUID()).toString("base64url")}`;
  vault.storeSecret(secretKey(id), secret);
  sqlite.prepare("UPDATE webhook_endpoints SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return secret;
}

export function updateWebhookEndpoint(sqlite: Database.Database, id: string, patch: {
  name?: string; url?: string; eventTypes?: string[]; allowPrivate?: boolean; enabled?: boolean;
}): WebhookEndpoint {
  const current = listWebhookEndpoints(sqlite).find((item) => item.id === id);
  if (!current) throw new Error("Không thấy webhook.");
  const next = {
    name: patch.name ?? current.name,
    url: patch.url ?? current.url,
    eventTypes: patch.eventTypes ?? current.eventTypes,
    allowPrivate: patch.allowPrivate ?? current.allowPrivate,
    enabled: patch.enabled ?? current.enabled,
  };
  if (!webhookUrlAllowed(next.url, next.allowPrivate)) throw new Error("Địa chỉ webhook không được phép.");
  sqlite.prepare(`UPDATE webhook_endpoints
    SET name = ?, url = ?, event_types = ?, allow_private = ?, enabled = ?, updated_at = ?
    WHERE id = ?`).run(next.name, next.url, JSON.stringify(next.eventTypes), next.allowPrivate ? 1 : 0, next.enabled ? 1 : 0, new Date().toISOString(), id);
  const updated = listWebhookEndpoints(sqlite).find((item) => item.id === id);
  if (!updated) throw new Error("Không thấy webhook.");
  return updated;
}

export function deleteWebhookEndpoint(sqlite: Database.Database, vault: TokenVault, id: string): void {
  sqlite.prepare("DELETE FROM webhook_endpoints WHERE id = ?").run(id);
  vault.storeSecret(secretKey(id), "");
}

export function enqueueWebhookDeliveries(sqlite: Database.Database, event: AgentEvent, now = new Date()): void {
  const endpoints = listWebhookEndpoints(sqlite).filter((item) => item.enabled && (item.eventTypes.length === 0 || item.eventTypes.includes(event.type)));
  const stamp = now.toISOString();
  const insert = sqlite.prepare(`INSERT INTO webhook_deliveries
    (id, endpoint_id, event_id, payload, attempt, status, next_attempt_at, created_at)
    VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)`);
  for (const endpoint of endpoints) {
    insert.run(randomUUID(), endpoint.id, event.id, JSON.stringify(event), stamp, stamp);
  }
}

export async function deliverDueWebhooks(sqlite: Database.Database, vault: TokenVault, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<number> {
  const due = sqlite.prepare(`SELECT id, endpoint_id, payload, attempt FROM webhook_deliveries
    WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 20`)
    .all(now.toISOString()) as Array<{ id: string; endpoint_id: string; payload: string; attempt: number }>;
  let sent = 0;
  for (const row of due) {
    const endpoint = listWebhookEndpoints(sqlite).find((item) => item.id === row.endpoint_id);
    const secret = vault.loadSecret(secretKey(row.endpoint_id));
    if (!endpoint?.enabled || !secret) {
      sqlite.prepare("UPDATE webhook_deliveries SET status = 'failed', last_error = ? WHERE id = ?").run("endpoint disabled", row.id);
      continue;
    }
    const deliveryId = `msg_${row.id.replace(/-/g, "")}`;
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = signWebhook(deliveryId, timestamp, row.payload, secret);
    try {
      const response = await fetchImpl(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-id": deliveryId,
          "webhook-timestamp": timestamp,
          "webhook-signature": signature,
        },
        body: row.payload,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        sqlite.prepare("UPDATE webhook_deliveries SET status = 'sent' WHERE id = ?").run(row.id);
        sent += 1;
        continue;
      }
      if (response.status < 500 && response.status !== 429) {
        sqlite.prepare("UPDATE webhook_deliveries SET status = 'failed', last_error = ? WHERE id = ?").run(`HTTP ${response.status}`, row.id);
        continue;
      }
      scheduleRetry(sqlite, row.id, row.attempt, endpoint, `HTTP ${response.status}`, now);
    } catch (error) {
      scheduleRetry(sqlite, row.id, row.attempt, endpoint, error instanceof Error ? error.message : "network", now);
    }
  }
  return sent;
}

function scheduleRetry(sqlite: Database.Database, id: string, attempt: number, endpoint: WebhookEndpoint, error: string, now: Date): void {
  const delay = webhookRetryDelayMs(attempt);
  const first = sqlite.prepare("SELECT created_at FROM webhook_deliveries WHERE endpoint_id = ? ORDER BY created_at LIMIT 1")
    .get(endpoint.id) as { created_at: string } | undefined;
  const failingFor = first ? now.getTime() - Date.parse(first.created_at) : 0;
  if (delay === null || failingFor > FAIL_WINDOW_MS) {
    sqlite.prepare("UPDATE webhook_endpoints SET enabled = 0, disabled_reason = ?, updated_at = ? WHERE id = ?")
      .run("failed", now.toISOString(), endpoint.id);
    sqlite.prepare("UPDATE webhook_deliveries SET status = 'failed', last_error = ? WHERE id = ?").run(error, id);
    createUserRequest(sqlite, {
      kind: "info",
      title: `Webhook ${endpoint.name} đã tắt`,
      whyVi: "Webhook lỗi liên tục nên đã được tắt. Hãy kiểm tra địa chỉ nhận.",
      actionUrl: "/settings/notifications",
      dedupeKey: `webhook-disabled:${endpoint.id}`,
      checkKind: "webhook",
    });
    return;
  }
  const next = new Date(now.getTime() + delay).toISOString();
  sqlite.prepare("UPDATE webhook_deliveries SET attempt = ?, next_attempt_at = ?, last_error = ? WHERE id = ?")
    .run(attempt + 1, next, error, id);
}
