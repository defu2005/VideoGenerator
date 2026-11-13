import { AGENT_EVENT_TYPES, webhookUrlAllowed } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { TokenVault } from "../publishing/tokenVault.js";
import { AppError } from "../lib/errors.js";
import {
  createWebhookEndpoint, deleteWebhookEndpoint, listWebhookEndpoints, rotateWebhookSecret, updateWebhookEndpoint,
} from "../events/webhooks.js";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url(),
  eventTypes: z.array(z.enum(AGENT_EVENT_TYPES)).default([]),
  allowPrivate: z.boolean().optional(),
}).strict();

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().url().optional(),
  eventTypes: z.array(z.enum(AGENT_EVENT_TYPES)).optional(),
  allowPrivate: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).strict();

export function registerWebhookRoutes(app: FastifyInstance, sqlite: Database.Database, vault: TokenVault): void {
  app.get("/api/webhooks", async () => ({
    endpoints: listWebhookEndpoints(sqlite).map(({ url, ...rest }) => ({ ...rest, url })),
  }));

  app.post("/api/webhooks", async (request) => {
    const body = Body.parse(request.body);
    if (!webhookUrlAllowed(body.url, body.allowPrivate === true)) {
      throw new AppError(400, "WEBHOOK_URL", "Chỉ nhận https công khai, hoặc http trên máy này. Mạng nội bộ cần được cho phép.");
    }
    const created = createWebhookEndpoint(sqlite, vault, body);
    return { endpoint: created.endpoint, secret: created.secret };
  });

  app.patch("/api/webhooks/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = Patch.parse(request.body);
    if (body.url && !webhookUrlAllowed(body.url, body.allowPrivate === true)) {
      const current = listWebhookEndpoints(sqlite).find((item) => item.id === id);
      if (!webhookUrlAllowed(body.url, body.allowPrivate ?? current?.allowPrivate ?? false)) {
        throw new AppError(400, "WEBHOOK_URL", "Chỉ nhận https công khai, hoặc http trên máy này. Mạng nội bộ cần được cho phép.");
      }
    }
    try {
      return { endpoint: updateWebhookEndpoint(sqlite, id, body) };
    } catch (error) {
      throw new AppError(400, "WEBHOOK_URL", error instanceof Error ? error.message : "Không sửa được webhook.");
    }
  });

  app.delete("/api/webhooks/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    deleteWebhookEndpoint(sqlite, vault, id);
    return { ok: true };
  });

  app.post("/api/webhooks/:id/rotate-secret", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { secret: rotateWebhookSecret(sqlite, vault, id) };
  });

  app.get("/api/webhooks/:id/deliveries", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rows = sqlite.prepare(`SELECT id, event_id, attempt, status, next_attempt_at, last_error, created_at
      FROM webhook_deliveries WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 50`).all(id);
    return { deliveries: rows };
  });

  app.post("/api/webhooks/:id/test", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const endpoint = listWebhookEndpoints(sqlite).find((item) => item.id === id);
    if (!endpoint) throw new AppError(404, "NOT_FOUND", "Không thấy webhook.");
    const { publishAgentEvent } = await import("../events/agentBus.js");
    const { deliverDueWebhooks } = await import("../events/webhooks.js");
    const event = publishAgentEvent({ type: "ping", summary: "Thử webhook" });
    await deliverDueWebhooks(sqlite, vault);
    return { ok: true, eventId: event.id };
  });
}
