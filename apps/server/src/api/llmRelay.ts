import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { LlmRelayGrantPatchSchema } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { RelayError, redactSecrets, type LlmRelay, type RelayCaller, type RelayPath } from "../providers/llm/relay.js";

/*
 * TASK-136. `/api/llm/relay/v1/*` is an OpenAI-compatible gateway for agents and worker nodes. It is allowlisted in the
 * auth guard because it authenticates itself (agent key with a profile, or a worker node token). Errors use the OpenAI
 * shape so any OpenAI client prints them. The admin routes live elsewhere (`/api/llm/relay-admin/*`) and use the normal
 * user session and `settings.*` permissions.
 */

const BODY_LIMIT = 16 * 1024 * 1024;

function sendError(reply: FastifyReply, error: RelayError, secrets: readonly string[]): FastifyReply {
  if (error.retryAfterSec) reply.header("retry-after", String(error.retryAfterSec));
  const type = error.status === 429 ? "rate_limit_error" : error.status === 401 || error.status === 403 ? "permission_error" : error.status >= 500 ? "server_error" : "invalid_request_error";
  return reply.code(error.status).send({ error: { message: redactSecrets(error.message, secrets), type, code: error.code } });
}

export function registerLlmRelayRoutes(app: FastifyInstance, relay: LlmRelay, secrets: readonly (string | undefined)[] = []): void {
  const hidden = secrets.filter((value): value is string => Boolean(value && value.length >= 6));

  async function guarded(reply: FastifyReply, work: () => Promise<unknown>): Promise<unknown> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof RelayError) return sendError(reply, error, hidden);
      throw error;
    }
  }

  async function authed(request: { headers: import("node:http").IncomingHttpHeaders }): Promise<RelayCaller> {
    return relay.authenticate(request.headers);
  }

  function forward(path: RelayPath) {
    return async (request: import("fastify").FastifyRequest, reply: FastifyReply): Promise<unknown> => guarded(reply, async () => {
      const caller = await authed(request);
      const jobHeader = request.headers["x-vg-job-id"];
      const controller = new AbortController();
      reply.raw.on("close", () => { if (!reply.raw.writableFinished) controller.abort(); });
      const result = await relay.relay(path, caller, request.body, {
        jobId: Array.isArray(jobHeader) ? jobHeader[0] : jobHeader,
        signal: controller.signal,
      });
      for (const [name, value] of Object.entries(result.headers)) reply.header(name, value);
      reply.header("x-accel-buffering", "no");
      return reply.code(result.status).type(result.contentType).send(result.body);
    });
  }

  const routeOptions = { bodyLimit: BODY_LIMIT };
  app.post("/api/llm/relay/v1/chat/completions", routeOptions, forward("chat/completions"));
  app.post("/api/llm/relay/v1/embeddings", routeOptions, forward("embeddings"));
  app.get("/api/llm/relay/v1/models", async (request, reply) => guarded(reply, async () => relay.listModels(await authed(request))));

  // ---- admin side (user session; the guard and ROUTE_RULES already cover /api/llm/*) ----
  function userOnly(request: { actor?: { kind?: string } | undefined }): void {
    if (request.actor?.kind !== "user") throw new AppError(403, "RELAY_ADMIN_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được xem hoặc sửa quyền dùng LLM của máy.");
  }

  app.get("/api/llm/relay-admin/status", async (request) => {
    userOnly(request);
    return relay.status(request.actor?.workspaceId ?? null);
  });

  app.put("/api/llm/relay-admin/grants", async (request, reply) => guarded(reply, async () => {
    userOnly(request);
    const body = z.object({ caller: z.string().min(1).max(200) }).and(LlmRelayGrantPatchSchema).parse(request.body);
    const { caller, ...patch } = body;
    if (caller !== "*" && !/^(agent:[a-z]+\/[A-Za-z0-9 ._-]{1,64}|node:[A-Za-z0-9_-]+)$/.test(caller)) {
      throw new AppError(400, "RELAY_BAD_CALLER", "Mã máy gọi phải có dạng agent:<loại>/<tên>, node:<id> hoặc *.");
    }
    const grant = relay.saveGrant(caller, patch, request.actor?.workspaceId ?? null);
    return { grant };
  }));

  app.delete("/api/llm/relay-admin/grants", async (request) => {
    userOnly(request);
    const { caller } = z.object({ caller: z.string().min(1).max(200) }).parse(request.query);
    if (caller === "*") throw new AppError(400, "RELAY_DEFAULT_KEEP", "Không xoá được hàng mặc định; hãy sửa giá trị của nó.");
    return { deleted: relay.deleteGrant(caller, request.actor?.workspaceId ?? null) };
  });
}
