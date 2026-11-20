import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
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
  NodeUploadTargetRequestSchema,
  PipelineStageSchema,
  SecretRequestSchema,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { LeaseService } from "../node/leaseService.js";
import type { LeaseSecretService } from "../node/leaseSecrets.js";
import type { NodeRow, NodeService } from "../node/nodeService.js";
import { readAppVersion } from "../render/appVersion.js";
import { getNodePlacement, saveNodePlacement } from "../node/settings.js";
import type { RunTransportService } from "../node/runTransport.js";

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
  runs?: RunTransportService,
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
    agent.addContentTypeParser("application/offset+octet-stream", (_request, payload, done) => done(null, payload));

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
      const runTransport = () => {
        if (!runs) throw new AppError(503, "PROJECT_RUNS_UNAVAILABLE", "Dịch vụ chạy dự án chưa sẵn sàng.");
        return runs;
      };

      authed.get("/api/nodes/agent/project-lease", async (request, reply) => {
        const run = runTransport().pendingFor(current(request));
        reply.header("cache-control", "no-store");
        return run ? { kind: "project", run } : reply.code(204).send();
      });
      authed.get("/api/nodes/agent/runs/:id/snapshot", async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        reply.header("cache-control", "no-store");
        return runTransport().snapshot(current(request), id, header(request, "x-lease-id") ?? "");
      });
      authed.post("/api/nodes/agent/runs/:id/checkpoint", { bodyLimit: 16 * 1024 * 1024 }, async (request) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        return runTransport().checkpoints.apply(current(request), id, request.body);
      });
      authed.post("/api/nodes/agent/runs/:id/finish", async (request) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const input = z.object({
          leaseId: z.string().uuid(), lastSeq: z.number().int().nonnegative(),
          reason: z.enum(["DONE", "BOUNDARY", "BUDGET", "PAUSED", "FAILED"]),
          blockedGate: PipelineStageSchema.optional(),
        }).strict().parse(request.body);
        return runTransport().finish(current(request), id, input);
      });
      authed.post("/api/nodes/agent/runs/:id/secrets", async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const input = z.object({ leaseId: z.string().uuid(), scopes: z.array(z.string().max(40)).max(24), publicKey: z.string().max(64) }).strict().parse(request.body);
        reply.header("cache-control", "no-store");
        return { secrets: runTransport().providerSecrets(current(request), id, input.leaseId, input.scopes, input.publicKey) };
      });
      authed.get("/api/nodes/agent/runs/:id/commands", async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const { after } = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
        reply.header("cache-control", "no-store");
        const abort = new AbortController();
        const disconnect = () => abort.abort();
        reply.raw.once("close", disconnect);
        try {
          return { commands: await runTransport().commands.poll(current(request), id, header(request, "x-lease-id") ?? "", after, abort.signal) };
        } finally {
          reply.raw.off("close", disconnect);
        }
      });
      authed.post("/api/nodes/agent/runs/:id/context/:kind", async (request, reply) => {
        const { id, kind } = z.object({ id: z.string().uuid(), kind: z.string().max(40) }).parse(request.params);
        reply.header("cache-control", "no-store");
        return runTransport().context(current(request), id, header(request, "x-lease-id") ?? "", kind, request.body);
      });

      authed.post("/api/nodes/agent/heartbeat", async (request) => {
        const body = HeartbeatRequestSchema.parse(request.body ?? {});
        return nodes.heartbeat(current(request), body);
      });

      authed.post("/api/nodes/agent/lease", async (request, reply) => {
        const { freeSlots, publicKey } = LeaseRequestSchema.parse(request.body ?? {});
        const lease = await leases.lease(current(request), freeSlots, publicKey, header(request, "x-vg-storage-urls") === "1");
        void reply.header("cache-control", "no-store");
        if (!lease) return reply.code(204).send();
        return lease;
      });

      authed.get("/api/nodes/agent/artifacts/:sha256", async (request, reply) => {
        const { sha256 } = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }).parse(request.params);
        const { jobId, runId } = z.object({ jobId: z.string().optional(), runId: z.string().uuid().optional() })
          .refine((value) => !!value.jobId !== !!value.runId, "Cần đúng một jobId hoặc runId").parse(request.query);
        const found = runId ? runTransport().artifact(current(request), runId, header(request, "x-lease-id") ?? "", sha256)
          : leases.artifactFor(current(request), jobId!, header(request, "x-lease-id"), sha256);
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

      const outputParams = z.object({ id: z.string(), "*": z.string() });
      const offsetHeader = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
      authed.head("/api/nodes/agent/runs/:id/outputs/*", async (request, reply) => {
        const { id, "*": name } = outputParams.parse(request.params);
        const value = await runTransport().offset(current(request), id, header(request, "x-lease-id") ?? "", name);
        reply.header("cache-control", "no-store").header("upload-offset", String(value.receivedBytes));
        if (value.size !== undefined) reply.header("upload-length", String(value.size));
        return reply.code(204).send();
      });
      authed.patch("/api/nodes/agent/runs/:id/outputs/*", async (request, reply) => {
        if (header(request, "content-type") !== "application/offset+octet-stream") throw new AppError(415, "UPLOAD_CONTENT_TYPE", "Cần application/offset+octet-stream.");
        const { id, "*": name } = outputParams.parse(request.params);
        const value = await runTransport().append(current(request), {
          jobId: id, name, leaseId: header(request, "x-lease-id") ?? "", sha256: header(request, "x-sha256") ?? "",
          size: offsetHeader.parse(header(request, "upload-length")),
        }, offsetHeader.parse(header(request, "upload-offset")), request.body as Readable | undefined ?? Readable.from([]));
        return reply.header("upload-offset", String(value.receivedBytes)).code(204).send();
      });
      authed.post("/api/nodes/agent/runs/:id/have", async (request) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z.object({ leaseId: z.string(), outputs: z.array(z.object({
          name: z.string().max(160), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        }).strict()).max(500) }).strict().parse(request.body);
        return { have: runTransport().have(current(request), id, body.leaseId, body.outputs) };
      });
      authed.head("/api/nodes/agent/jobs/:id/outputs/*", async (request, reply) => {
        const { id, "*": name } = outputParams.parse(request.params);
        const value = await leases.uploadOffset(current(request), id, header(request, "x-lease-id"), name);
        reply.header("cache-control", "no-store").header("upload-offset", String(value.receivedBytes));
        if (value.size !== undefined) reply.header("upload-length", String(value.size));
        return reply.code(204).send();
      });
      authed.patch("/api/nodes/agent/jobs/:id/outputs/*", async (request, reply) => {
        if (header(request, "content-type") !== "application/offset+octet-stream") {
          throw new AppError(415, "UPLOAD_CONTENT_TYPE", "Cần application/offset+octet-stream.");
        }
        const { id, "*": name } = outputParams.parse(request.params);
        const value = await leases.appendOutput(current(request), {
          jobId: id, name, leaseId: header(request, "x-lease-id") ?? "", sha256: header(request, "x-sha256") ?? "",
          size: offsetHeader.parse(header(request, "upload-length")),
        }, offsetHeader.parse(header(request, "upload-offset")), request.body as Readable | undefined ?? Readable.from([]));
        return reply.header("upload-offset", String(value.receivedBytes)).code(204).send();
      });
      authed.post("/api/nodes/agent/jobs/:id/have", async (request) => {
        const { id } = z.object({ id: z.string() }).parse(request.params);
        const body = z.object({ leaseId: z.string(), outputs: z.array(z.object({
          name: z.string().max(160), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        }).strict()).max(500) }).strict().parse(request.body);
        return { have: leases.haveOutputs(current(request), id, body.leaseId, body.outputs) };
      });

      authed.post("/api/nodes/agent/jobs/:id/secret", async (request, reply) => {
        const { id } = z.object({ id: z.string() }).parse(request.params);
        const body = SecretRequestSchema.parse(request.body ?? {});
        void reply.header("cache-control", "no-store");
        return { secret: leases.refetchSecret(current(request), id, body.leaseId, body.publicKey) };
      });

      authed.post("/api/nodes/agent/jobs/:id/upload-targets", async (request, reply) => {
        const { id } = z.object({ id: z.string() }).parse(request.params);
        const body = NodeUploadTargetRequestSchema.parse(request.body ?? {});
        void reply.header("cache-control", "no-store");
        return { target: await leases.outputTarget(current(request), { jobId: id, ...body }) };
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
