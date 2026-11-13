import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { touchFromOwner } from "../operator/autopilot.js";
import { GovernorSettingsSchema, writeGovernorSettings, type ResourceGovernor } from "../jobs/resourceGovernor.js";

/** TASK-129b: machine load, slots per class and the governor settings. */
export function registerResourceRoutes(app: FastifyInstance, sqlite: Database.Database, governor: ResourceGovernor): void {
  app.get("/api/resources", async () => ({ ...governor.status(), starved: governor.starved() }));

  app.get("/api/settings/governor", async () => ({ settings: governor.settings(), status: governor.status() }));

  app.put("/api/settings/governor", async (request) => {
    const parsed = GovernorSettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "Cài đặt tài nguyên không hợp lệ.");
    for (const [name, range] of Object.entries(parsed.data.classes)) {
      if (range && range.min > range.max) throw new AppError(400, "INVALID_INPUT", `Lớp ${name}: tối thiểu không được lớn hơn tối đa.`);
    }
    touchFromOwner(request.headers, sqlite, "governor:settings");
    const settings = writeGovernorSettings(sqlite, parsed.data);
    return { settings, status: governor.status() };
  });
}
