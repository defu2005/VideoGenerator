import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-tts-settings-"));
const apps: ReturnType<typeof buildApp>[] = [];

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  rmSync(root, { recursive: true, force: true });
});

describe("TTS settings API", () => {
  it("stores a provider key without returning it", async () => {
    const dataDir = join(root, "run");
    const app = buildApp({
      config: parseConfig({
        DATA_DIR: dataDir,
        DATABASE_PATH: join(dataDir, "app.db"),
        WORKER_ENABLED: "false",
        LOG_LEVEL: "silent",
        TTS_PROVIDER: "mock",
      }),
    });
    apps.push(app);
    const secret = "tts-test-key-not-for-logs";
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings/tts/secret",
      payload: { provider: "google_cloud", apiKey: secret },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ provider: "google_cloud", configured: true });
    expect(saved.body).not.toContain(secret);

    const settings = await app.inject({ method: "GET", url: "/api/settings/tts" });
    expect(settings.statusCode).toBe(200);
    expect(settings.body).not.toContain(secret);
    const google = settings.json().providers.find((provider: { id: string }) => provider.id === "google_cloud");
    expect(google).toMatchObject({ configured: true, paid: true, wordTimings: true });
    expect(google.apiKey).toBeUndefined();
  });
});
