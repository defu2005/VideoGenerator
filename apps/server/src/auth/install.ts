import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/client.js";
import type { AppConfig } from "../lib/config.js";
import type { AuthActor } from "./actor.js";
import { registerAuthGuard } from "./guard.js";
import { registerAuthHandler } from "./handler.js";
import type { AuthHandle } from "./handle.js";
import { createAuth } from "./instance.js";
import { ensureLocalServiceKey, findOwnerId } from "./localKey.js";
import { trustedOrigins } from "./origins.js";
import { loadAuthSecret } from "./secret.js";
import { ensureDefaultWorkspace } from "./workspaces.js";
import { purgeOldAudit, registerApiAudit } from "./auditLog.js";
import { runInRequestContext } from "./requestContext.js";
import { registerMeRoutes } from "./meRoutes.js";
import { registerPermissionHook } from "./permissionHook.js";
import { registerSetupRoutes } from "./setup.js";
import { registerAccountHooks } from "./accountGuard.js";
import { registerAcceptInviteRoutes } from "./acceptInvite.js";
import { registerTeamRoutes } from "./teamRoutes.js";

export function installAuth(server: FastifyInstance, input: {
  config: AppConfig;
  sqlite: Database.Database;
  db: AppDatabase;
  testActor?: AuthActor;
}): void {
  const secret = loadAuthSecret(input.config.DATA_DIR, input.config.BETTER_AUTH_SECRET);
  const origins = trustedOrigins(input.config);
  const auth = createAuth({
    db: input.db,
    secret,
    baseURL: `http://127.0.0.1:${input.config.PORT}`,
    trustedOrigins: origins,
  });
  if (input.testActor) ensureTestWorkspace(input.sqlite, input.testActor);
  const setup = registerSetupRoutes(server, {
    auth,
    sqlite: input.sqlite,
    dataDir: input.config.DATA_DIR,
    log: server.log,
  });
  registerAccountHooks(server, { auth, sqlite: input.sqlite });
  registerAcceptInviteRoutes(server, { auth, sqlite: input.sqlite });
  registerAuthHandler(server, auth);
  server.addHook("onRequest", (_request, _reply, done) => runInRequestContext(done));
  registerAuthGuard(server, { auth, sqlite: input.sqlite, testActor: input.testActor });
  const permissions = registerPermissionHook(server, input.sqlite);
  server.decorate("vgRoutes", permissions.routes);
  registerApiAudit(server, input.sqlite);
  registerMeRoutes(server, input.sqlite);
  registerTeamRoutes(server, input.sqlite);
  const auditPurge = setInterval(() => {
    try { purgeOldAudit(input.sqlite); } catch { /* retention is best effort */ }
  }, 24 * 3600_000);
  auditPurge.unref();
  server.addHook("onClose", async () => clearInterval(auditPurge));

  const handle: AuthHandle = {
    setupCode: setup.setupCode,
    async verifyApiKey(key) {
      const result = await auth.api.verifyApiKey({ body: { key } });
      return {
        valid: result.valid === true,
        keyId: result.key?.id,
        userId: result.key?.referenceId,
      };
    },
    async revokeApiKey(keyId) {
      const ownerId = findOwnerId(input.sqlite);
      if (!ownerId) throw new Error("No owner");
      await auth.api.updateApiKey({ body: { keyId, enabled: false, userId: ownerId } });
    },
  };
  server.decorate("vgAuth", handle);

  server.addHook("onReady", async () => {
    if (!findOwnerId(input.sqlite)) return;
    const ownerId = findOwnerId(input.sqlite);
    if (ownerId) ensureDefaultWorkspace(input.sqlite, ownerId, server.log);
    try { purgeOldAudit(input.sqlite); } catch { /* retention is best effort */ }
    try {
      await ensureLocalServiceKey({ auth, sqlite: input.sqlite, dataDir: input.config.DATA_DIR });
    } catch {
      server.log.error("Không tạo được khoá máy cục bộ");
    }
  });
}

/** Tests run as a fixed actor; give it a real workspace row so ids resolve. */
function ensureTestWorkspace(sqlite: Database.Database, actor: AuthActor): void {
  if (!actor.workspaceId) return;
  sqlite.prepare(
    "INSERT OR IGNORE INTO organization (id, name, slug, created_at, metadata) VALUES (?, ?, ?, ?, ?)",
  ).run(actor.workspaceId, "Không gian chính", `test-${actor.workspaceId}`, Date.now(), JSON.stringify(actor.flags ?? {}));
}
