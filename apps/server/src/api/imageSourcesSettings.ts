import { ApiErrorSchema, ImageSourcesSettingsSchema, ImageSourcesSettingsStatusSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import { getImageSourcesSettingsStatus, saveImageSourcesSettings } from "../settings/imageSources.js";

export function registerImageSourcesSettingsRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  config: AppConfig,
): void {
  app.get("/api/settings/image-sources", {
    schema: { response: { 200: ImageSourcesSettingsStatusSchema } },
  }, async () => getImageSourcesSettingsStatus(sqlite, config));

  app.put("/api/settings/image-sources", {
    schema: {
      body: ImageSourcesSettingsSchema,
      response: { 200: ImageSourcesSettingsStatusSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const body = ImageSourcesSettingsSchema.parse(request.body);
    saveImageSourcesSettings(sqlite, body);
    return getImageSourcesSettingsStatus(sqlite, config);
  });
}
