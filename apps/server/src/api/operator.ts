import { OperatorSettingsUpdateSchema, StandingOrderInputSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OperatorService } from "../operator/service.js";

const IdParams = z.object({ id: z.string().min(1).max(80) }).strict();

export function registerOperatorRoutes(app: FastifyInstance, operator: OperatorService): void {
  app.get("/api/operator/overview", async () => operator.overview());

  app.get("/api/operator/conversations/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const runId = z.object({ runId: z.string().uuid().optional() }).parse(request.query).runId;
    return {
      id,
      messages: operator.listMessages(id),
      run: runId ? operator.getRun(runId) ?? null : null,
    };
  });

  app.post("/api/operator/conversations/:id/messages", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ text: z.string().trim().min(1).max(8000) }).strict().parse(request.body);
    return operator.submit({ conversationId: id, prompt: body.text, kind: "chat", origin: "user" });
  });

  app.post("/api/operator/conversations/:id/stop", async (request) => {
    IdParams.parse(request.params);
    operator.stopActive();
    return { ok: true };
  });

  app.post("/api/operator/conversations/:id/new-session", async (request) => {
    const { id } = IdParams.parse(request.params);
    operator.newSession(id);
    return { ok: true };
  });

  app.put("/api/operator/settings", async (request) => {
    const body = OperatorSettingsUpdateSchema.parse(request.body);
    return operator.saveSettings(body);
  });

  app.get("/api/operator/orders", async () => ({ items: operator.listOrders() }));

  app.post("/api/operator/orders", async (request) => {
    const body = StandingOrderInputSchema.parse(request.body);
    return operator.saveStandingOrder(body);
  });

  app.put("/api/operator/orders/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = StandingOrderInputSchema.parse(request.body);
    return operator.saveStandingOrder({ ...body, id });
  });

  app.delete("/api/operator/orders/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    operator.deleteOrder(id);
    return { ok: true };
  });

  app.post("/api/operator/skills/promote", async (request) => {
    const body = z.object({ path: z.string().min(1).max(300) }).strict().parse(request.body);
    return operator.promoteSkill(body.path);
  });

  app.post("/api/operator/open", async () => operator.openInCursor());
}
