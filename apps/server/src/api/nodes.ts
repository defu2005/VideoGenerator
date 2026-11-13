import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  CompleteRequestSchema,
  FailRequestSchema,
  HeartbeatRequestSchema,
  JoinRequestSchema,
  LeaseRequestSchema,
  NodePatchSchema,
  NodePlacementUpdateSchema,
  NodeTargetVersionSchema,
  SecretRequestSchema,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { LeaseService } from "../node/leaseService.js";
import type { LeaseSecretService } from "../node/leaseSecrets.js";
import type { NodeRow, NodeService } from "../node/nodeService.js";
import { readAppVersion } from "../render/appVersion.js";
import { getNodePlacement, saveNodePlacement } from "../node/settings.js";

const JOIN_LIMIT = 10;
const JOIN_WINDOW_MS = 60_000;

const UNAUTHORIZED = new AppError(401, "NODE_UNAUTHORIZED", "Token máy worker không hợp lệ hoặc đã bị thu hồi.");

const nodeOf = new WeakMap<FastifyRequest, NodeRow>();

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function registerNodeRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  config: AppConfig,
  nodes: NodeService,
  leases: LeaseService,
  secrets: LeaseSecretService,
): void {
  // ---- admin side: user session, rule `nodes.manage` in routePermissions.ts ----
  // `nodeTargetVersion` is fixed to "control": a render bundle is tied to the control plane's version, so a node on another
  // version cannot be trusted to render it. The field is read-only; it exists so the page can say so.
  app.get("/api/nodes", async () => ({
    nodes: nodes.list(),
    settings: getNodePlacement(sqlite),
    targetVersion: readAppVersion(),
    nodeTargetVersion: NodeTargetVersionSchema.parse("control"),
  }));

  app.get("/api/nodes/secrets", async () => ({ grants: secrets.list(100) }));

  app.get("/api/nodes/:id", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return nodes.detail(id);
  });

  app.post("/api/nodes/join-tokens", async (request, reply) => {
    const created = nodes.createJoinToken(request.actor);
    void reply.header("cache-control", "no-store");
    return created;
  });

  app.get("/api/nodes/settings", async () => getNodePlacement(sqlite));

  app.put("/api/nodes/settings", async (request) => {
    const { nodeTargetVersion, ...rest } = (request.body ?? {}) as Record<string, unknown>;
    if (nodeTargetVersion !== undefined) NodeTargetVersionSchema.parse(nodeTargetVersion); // only "control" is allowed
    return saveNodePlacement(sqlite, NodePlacementUpdateSchema.parse(rest));
  });

  app.patch("/api/nodes/:id", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return nodes.patch(id, NodePatchSchema.parse(request.body ?? {}));
  });

  app.post("/api/nodes/:id/revoke", async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    nodes.revoke(id, request.actor);
    secrets.revokeNode(id, "node_revoked");
    return { ok: true };
  });

  // ---- agent side: node token, never a user session ----
  const attempts = new Map<string, number[]>();
  app.register(async (agent) => {
    agent.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));

    agent.post("/api/nodes/agent/join", async (request) => {
      const now = Date.now();
      const key = request.ip;
      const recent = (attempts.get(key) ?? []).filter((at) => now - at < JOIN_WINDOW_MS);
      if (recent.length >= JOIN_LIMIT) {
        throw new AppError(429, "JOIN_RATE_LIMITED", "Thử quá nhiều lần. Chờ một phút rồi thử lại.");
      }
      recent.push(now);
      attempts.set(key, recent);
      const input = JoinRequestSchema.parse(request.body ?? {});
      return nodes.join(input);
    });

    agent.register(async (authed) => {
      authed.addHook("onRequest", async (request) => {
        const node = nodes.authenticate(bearer(request));
        if (!node) throw UNAUTHORIZED;
        nodeOf.set(request, node);
      });
      const current = (request: FastifyRequest): NodeRow => nodeOf.get(request)!;

      authed.post("/api/nodes/agent/heartbeat", async (request) => {
        const body = HeartbeatRequestSchema.parse(request.body ?? {});
        return nodes.heartbeat(current(request), body);
      });

      authed.post("/api/nodes/agent/lease", async (request, reply) => {
        const { freeSlots, publicKey } = LeaseRequestSchema.parse(request.body ?? {});
        const lease = await leases.lease(current(request), freeSlots, publicKey);
        void reply.header("cache-control", "no-store");
        if (!lease) return reply.code(204).send();
        return lease;
      });

      authed.get("/api/nodes/agent/artifacts/:sha256", async (request, reply) => {
        const { sha256 } = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }).parse(request.params);
        const { jobId } = z.object({ jobId: z.string() }).parse(request.query);
        const found = leases.artifactFor(current(request), jobId, header(request, "x-lease-id"), sha256);
        void reply.header("content-length", found.size);
        void reply.header("content-type", "application/octet-stream");
        return reply.send(createReadStream(found.path));
      });

      authed.put("/api/nodes/agent/jobs/:id/outputs/*", async (request) => {
        const { id } = z.object({ id: z.string() }).parse(request.params);
        const name = String((request.params as Record<string, string>)["*"] ?? "");
        const length = Number(header(request, "content-length") ?? 0);
        if (length > config.NODE_MAX_UPLOAD_MB * 1024 * 1024) {
          throw new AppError(422, "UPLOAD_TOO_LARGE", "Tệp tải lên vượt giới hạn.");
        }
        return leases.receiveOutput(
          current(request),
          id,
          header(request, "x-lease-id"),
          name,
          header(request, "x-sha256"),
          request.body as NodeJS.ReadableStream as import("node:stream").Readable,
        );
      });

      authed.post("/api/nodes/agent/jobs/:id/secret", async (request, reply) => {
        const { id } = z.object({ id: z.string() }).parse(request.params);
        const body = SecretRequestSchema.parse(request.body ?? {});
        void reply.header("cache-control", "no-store");
        return { secret: leases.refetchSecret(current(request), id, body.leaseId, body.publicKey) };
      });

      authed.post("/api/nodes/agent/jobs/:id/complete", async (request) => {
        const { id } = z.object({ id: z.string() }).parse(request.params);
        const body = CompleteRequestSchema.parse(request.body ?? {});
        await leases.complete(current(request), id, body);
        return { ok: true };
      });

      authed.post("/api/nodes/agent/jobs/:id/fail", async (request) => {
        const { id } = z.object({ id: z.string() }).parse(request.params);
        const body = FailRequestSchema.parse(request.body ?? {});
        leases.fail(current(request), id, body);
        return { ok: true };
      });
    });
  });
}
