import { ApiErrorSchema, WebImageSettingsSchema, WebImageSettingsStatusSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import { getWebImageSettingsStatus, saveWebImageSettings } from "../settings/webImage.js";

export function registerWebImageSettingsRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  config: AppConfig,
): void {
  app.get("/api/settings/web-image", {
    schema: { response: { 200: WebImageSettingsStatusSchema } },
  }, async () => getWebImageSettingsStatus(sqlite, config));

  app.put("/api/settings/web-image", {
    schema: {
      body: WebImageSettingsSchema,
      response: { 200: WebImageSettingsStatusSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const body = WebImageSettingsSchema.parse(request.body);
    saveWebImageSettings(sqlite, body);
    return getWebImageSettingsStatus(sqlite, config);
  });
}
