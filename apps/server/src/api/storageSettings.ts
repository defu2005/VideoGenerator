import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defaultWorkspaceId } from "../auth/workspaces.js";
import { AppError } from "../lib/errors.js";
import { StorageSettingsUpdateSchema, type StorageSettingsStore } from "../storage/settings.js";
import { GcSettingsSchema, saveGcSettings } from "../storage/gcSettings.js";
import type { FileGc } from "../storage/fileGc.js";
import { readDiskPressure } from "../storage/diskPressure.js";
import { z } from "zod";

export function registerStorageSettingsRoutes(app: FastifyInstance, db: Database.Database, storage: StorageSettingsStore, gc?: FileGc): void {
  function requireAdministrator(request: FastifyRequest) {
    const actor = request.actor;
    if (actor?.kind !== "user" || (actor.role !== "owner" && actor.role !== "admin") || actor.workspaceId !== defaultWorkspaceId(db)) {
      throw new AppError(403, "STORAGE_SETTINGS_REFUSED", "Chỉ quản trị viên không gian làm việc mặc định được cấu hình kho tệp của máy chủ.");
    }
  }

  app.get("/api/settings/storage", async (request, reply) => {
    requireAdministrator(request);
    void reply.header("cache-control", "no-store");
    return storage.status();
  });
  app.put("/api/settings/storage", async (request) => {
    requireAdministrator(request);
    const { settings, credentials } = StorageSettingsUpdateSchema.parse(request.body);
    storage.update(settings, credentials);
    return storage.status();
  });
  app.post("/api/settings/storage/test", async (request) => {
    requireAdministrator(request);
    return storage.probe();
  });
  if (gc) {
    let purging = false;
    app.get("/api/settings/storage/files", async (request) => {
      requireAdministrator(request);
      return { ...gc.report(), diskPressure: readDiskPressure(db) };
    });
    app.put("/api/settings/storage/gc-settings", async (request) => {
      requireAdministrator(request);
      if (purging) throw new AppError(409, "STORAGE_GC_BUSY", "Đang dọn kho tệp.");
      return saveGcSettings(db, GcSettingsSchema.parse(request.body));
    });
    app.post("/api/settings/storage/dry-run", async (request) => {
      requireAdministrator(request);
      return { local: gc.run({ dryRun: true, purge: true }), remote: await gc.runBlobs({ dryRun: true, purge: true }) };
    });
    app.post("/api/settings/storage/purge", async (request) => {
      requireAdministrator(request);
      const { confirm } = z.object({ confirm: z.literal(true) }).strict().parse(request.body);
      if (purging) throw new AppError(409, "STORAGE_GC_BUSY", "Đang dọn kho tệp.");
      purging = confirm;
      try {
        const remote = await gc.runBlobs({ purge: true });
        const local = gc.run({ purge: true });
        return { local, remote };
      } finally { purging = false; }
    });
  }
}
