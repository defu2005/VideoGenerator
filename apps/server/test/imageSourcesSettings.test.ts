import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/lib/config.js";
import {
  getImageSourcesSettingsStatus,
  isImageSourceEnabledInSettings,
  saveImageSourcesSettings,
} from "../src/settings/imageSources.js";

function memoryDb(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return sqlite;
}

describe("image sources settings", () => {
  it("reports key status without exposing secrets and honors on/off toggles", () => {
    const sqlite = memoryDb();
    const config = parseConfig({
      WORKER_ENABLED: "false",
      IMAGE_PROVIDERS: "mock",
      PEXELS_API_KEY: "secret-pexels",
      PIXABAY_API_KEY: "",
    });
    const status = getImageSourcesSettingsStatus(sqlite, config);
    const pexels = status.sources.find((row) => row.id === "pexels");
    const pixabay = status.sources.find((row) => row.id === "pixabay");
    const nasa = status.sources.find((row) => row.id === "nasa");
    expect(pexels).toMatchObject({ keyRequired: true, keyConfigured: true, enabled: false });
    expect(status.sources.find((row) => row.id === "wikimedia")?.enabled).toBe(false);
    expect(status.sources.find((row) => row.id === "openverse")?.enabled).toBe(false);
    expect(nasa?.enabled).toBe(true);
    expect(pixabay).toMatchObject({ keyRequired: true, keyConfigured: false });
    expect(nasa).toMatchObject({ keyRequired: false, keyConfigured: true });
    expect(JSON.stringify(status)).not.toContain("secret-pexels");

    saveImageSourcesSettings(sqlite, {
      enabled: {
        ...status.enabled,
        nasa: false,
      },
    });
    expect(isImageSourceEnabledInSettings(sqlite, "nasa")).toBe(false);
    expect(isImageSourceEnabledInSettings(sqlite, "wikimedia")).toBe(false);
    expect(isImageSourceEnabledInSettings(sqlite, "flickr")).toBe(true);

    saveImageSourcesSettings(sqlite, { enabled: { ...status.enabled, wikimedia: true } });
    expect(isImageSourceEnabledInSettings(sqlite, "wikimedia")).toBe(true);
  });
});
