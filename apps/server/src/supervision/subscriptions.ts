import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";

/**
 * TASK-129a step 2: push subscriptions. An instance subscribes to a webhook endpoint; a new message is queued
 * for it only when its kinds and scope match and one of its active assignments covers the message's project.
 * The payload carries ids and metadata only, never the body: the receiver reads the body with agent_inbox or agent_thread.
 * Delivery reuses webhook_deliveries, so signing and retry come from events/webhooks.ts.
 */

export type SubscriptionScope = { projectId?: string; profileId?: string; stage?: string };

type SubRow = {
  id: string; workspace_id: string; instance: string; kinds: string; scope: string; webhook_endpoint_id: string | null; enabled: number;
};

function hasActiveAssignment(sqlite: Database.Database, workspaceId: string, instance: string): boolean {
  return Boolean(sqlite.prepare("SELECT 1 FROM agent_assignments WHERE workspace_id = ? AND instance = ? AND active = 1 LIMIT 1").get(workspaceId, instance));
}

export function subscribe(sqlite: Database.Database, workspaceId: string, input: {
  instance: string; webhookEndpointId: string; kinds?: string[]; scope?: SubscriptionScope;
}, now = new Date()): { id: string } {
  // Messages carry no profile or stage yet, so such a scope could never match; refuse it instead of storing a dead subscription.
  if (input.scope?.profileId || input.scope?.stage) {
    throw new AppError(422, "SUBSCRIPTION_UNSUPPORTED_SCOPE", "Đăng ký theo profile hoặc stage chưa được hỗ trợ; chỉ dùng projectId.");
  }
  if (!hasActiveAssignment(sqlite, workspaceId, input.instance)) {
    throw new AppError(422, "SUBSCRIPTION_NO_ASSIGNMENT", "Instance chưa có việc được giao nên không đăng ký nhận tin.");
  }
  const endpoint = sqlite.prepare("SELECT id FROM webhook_endpoints WHERE id = ? AND workspace_id = ?").get(input.webhookEndpointId, workspaceId);
  if (!endpoint) throw new AppError(422, "SUBSCRIPTION_BAD_ENDPOINT", "Webhook không thuộc workspace này.");
  const id = randomUUID();
  const stamp = now.toISOString();
  sqlite.prepare(`INSERT INTO agent_subscriptions (id, workspace_id, instance, kinds, scope, delivery, webhook_endpoint_id, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'webhook', ?, 1, ?, ?)`)
    .run(id, workspaceId, input.instance, JSON.stringify(input.kinds ?? []), JSON.stringify(input.scope ?? {}), input.webhookEndpointId, stamp, stamp);
  return { id };
}

export function unsubscribe(sqlite: Database.Database, workspaceId: string, id: string, now = new Date()): void {
  const result = sqlite.prepare("UPDATE agent_subscriptions SET enabled = 0, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .run(now.toISOString(), id, workspaceId);
  if (result.changes === 0) throw new AppError(404, "SUBSCRIPTION_NOT_FOUND", "Không thấy đăng ký này.");
}

export type RoutableMessage = {
  id: string; workspaceId: string; threadId: string; fromInstance: string; kind: string;
  projectId: string | null; missionId: string | null; createdAt: string; type?: "agent.message" | "agent.question_escalated";
};

/**
 * Queue one webhook delivery per matching subscription. A subscription pushes what its instance can see in its inbox:
 * `isAddressed` is the mailbox's own addressing check, so the push and agent_inbox never disagree.
 * Returns how many were queued.
 */
export function routeToSubscribers(sqlite: Database.Database, msg: RoutableMessage, isAddressed: (instance: string) => boolean, now = new Date()): number {
  const subs = sqlite.prepare("SELECT * FROM agent_subscriptions WHERE workspace_id = ? AND enabled = 1").all(msg.workspaceId) as SubRow[];
  const stamp = now.toISOString();
  let queued = 0;
  for (const sub of subs) {
    if (sub.instance === msg.fromInstance || !sub.webhook_endpoint_id) continue;
    const kinds = JSON.parse(sub.kinds) as string[];
    if (kinds.length && !kinds.includes(msg.kind)) continue;
    const scope = JSON.parse(sub.scope) as SubscriptionScope;
    // Messages carry no profile or stage yet, so a subscription scoped to either can never match.
    if (scope.profileId || scope.stage) continue;
    if (scope.projectId && scope.projectId !== msg.projectId) continue;
    if (!isAddressed(sub.instance)) continue;
    const endpoint = sqlite.prepare("SELECT enabled FROM webhook_endpoints WHERE id = ?").get(sub.webhook_endpoint_id) as { enabled: number } | undefined;
    if (!endpoint || endpoint.enabled !== 1) continue;
    const payload = {
      type: msg.type ?? "agent.message", messageId: msg.id, threadId: msg.threadId, kind: msg.kind, fromInstance: msg.fromInstance,
      recipient: sub.instance, projectId: msg.projectId, missionId: msg.missionId, createdAt: msg.createdAt,
    };
    sqlite.prepare(`INSERT INTO webhook_deliveries (id, endpoint_id, event_id, payload, attempt, status, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)`).run(randomUUID(), sub.webhook_endpoint_id, msg.id, JSON.stringify(payload), stamp, stamp);
    queued += 1;
  }
  return queued;
}
