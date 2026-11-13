import { randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import type { VideoAgentAuth } from "./instance.js";
import { ensureLocalServiceKey } from "./localKey.js";
import { ensureDefaultWorkspace } from "./workspaces.js";

const SETUP_HINT = "Không tạo được tài khoản. Kiểm tra tên, email và mật khẩu (ít nhất 8 ký tự).";
const FORBIDDEN = "Chỉ tạo được chủ sở hữu từ máy này, hoặc kèm đúng mã thiết lập.";
const ALREADY = "Đã có chủ sở hữu.";

export function userCount(sqlite: Database.Database): number {
  const row = sqlite.prepare("SELECT COUNT(*) AS count FROM user").get() as { count: number };
  return row.count;
}

export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const host = ip.toLowerCase().replace(/^::ffff:/, "");
  return host === "127.0.0.1" || host === "::1" || host === "0:0:0:0:0:0:0:1";
}

function codesMatch(expected: string | null, given: unknown): boolean {
  if (!expected || typeof given !== "string" || given.length === 0) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return {};
  return request.body as Record<string, unknown>;
}

async function createOwner(auth: VideoAgentAuth, sqlite: Database.Database, input: {
  name: string;
  email: string;
  password: string;
}): Promise<string> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const created = await ctx.internalAdapter.createUser({
    email: input.email,
    name: input.name,
    emailVerified: true,
    role: "owner",
  }, { method: "email-password" });
  try {
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: hash,
    });
    sqlite.prepare("UPDATE user SET role = 'owner' WHERE id = ?").run(created.id);
  } catch (error) {
    await ctx.internalAdapter.deleteUser(created.id).catch(() => undefined);
    throw error;
  }
  return created.id;
}

export function registerSetupRoutes(server: FastifyInstance, input: {
  auth: VideoAgentAuth;
  sqlite: Database.Database;
  dataDir: string;
  log: FastifyInstance["log"];
}): { setupCode: () => string | null } {
  let setupCode: string | null = null;
  let tail: Promise<void> = Promise.resolve();

  if (userCount(input.sqlite) === 0) {
    setupCode = randomBytes(32).toString("base64url");
    input.log.warn(`Mã thiết lập một lần (chỉ dùng khi không mở từ máy này): ${setupCode}`);
  }

  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  server.get("/api/setup/status", async () => ({ userExists: userCount(input.sqlite) > 0 }));

  server.post("/api/setup/owner", async (request, reply) => {
    const body = readBody(request);
    if (userCount(input.sqlite) > 0) throw new AppError(409, "SETUP_DONE", ALREADY);
    const allowed = isLoopbackAddress(request.ip) || codesMatch(setupCode, body.setupCode);
    if (!allowed) throw new AppError(403, "FORBIDDEN", FORBIDDEN);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
    if (name.length < 1 || name.length > 80 || !emailOk || password.length < 8 || password.length > 128) {
      throw new AppError(400, "VALIDATION_ERROR", SETUP_HINT);
    }

    const ownerId = await exclusive(async () => {
      if (userCount(input.sqlite) > 0) throw new AppError(409, "SETUP_DONE", ALREADY);
      let id: string;
      try {
        id = await createOwner(input.auth, input.sqlite, { name, email, password });
      } catch (error) {
        if (error instanceof AppError) throw error;
        input.log.error("Owner setup failed");
        throw new AppError(400, "VALIDATION_ERROR", SETUP_HINT);
      }
      try {
        ensureDefaultWorkspace(input.sqlite, id, input.log);
      } catch {
        input.log.error("Không tạo được không gian làm việc mặc định");
      }
      try {
        await ensureLocalServiceKey({
          auth: input.auth,
          sqlite: input.sqlite,
          dataDir: input.dataDir,
          ownerId: id,
        });
      } catch {
        input.log.error("Không tạo được khoá máy cục bộ");
      }
      setupCode = null;
      return id;
    });
    void ownerId;
    return reply.code(201).send({ ok: true });
  });

  return { setupCode: () => setupCode };
}
