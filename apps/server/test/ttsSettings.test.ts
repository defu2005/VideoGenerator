import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig } from "../src/lib/config.js";
import { runWithAutonomyBudget } from "../src/operator/autonomyBudget.js";
import { TtsProviderRegistry } from "../src/providers/tts/registry.js";
import type { TokenVault } from "../src/publishing/tokenVault.js";

const root = mkdtempSync(join(tmpdir(), "vg-tts-settings-"));
const apps: ReturnType<typeof buildApp>[] = [];

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  rmSync(root, { recursive: true, force: true });
});

describe("TTS settings API", () => {
  it("uses offline TTS when the budget blocks a configured cloud voice", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("No cloud request expected"); });
    const spawnProcess = vi.fn(() => { throw new Error("No CLI expected"); });
    const registry = new TtsProviderRegistry(parseConfig({ DATA_DIR: root, TTS_PROVIDER: "mock" }), {
      fetchImpl, spawnProcess,
      vault: { loadSecret: () => "fixture-cloud-key" } as unknown as TokenVault,
    });
    const result = await runWithAutonomyBudget(
      () => ({ state: "stop", retryAt: "2026-11-10T17:00:00.000Z" }),
      () => registry.synthesizePreview({ providerId: "google_cloud", voice: "cloud-only", text: "Giọng thử.", outPath: join(root, "budget.wav") }),
    );
    expect(result.providerId).toBe("mock");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });
  it("stores a provider key without returning it", async () => {
    const dataDir = join(root, "run");
    const app = buildApp({ testActor, 
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
