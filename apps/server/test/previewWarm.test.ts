import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { previewWarmState, warmPreviewRuntime } from "../src/preview/shotRenderer.js";

const root = mkdtempSync(join(tmpdir(), "vg-previewwarm-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("preview warm-up (TASK-139b)", () => {
  it("building the app does not start the warm-up", async () => {
    const config = parseConfig({
      DATA_DIR: join(root, "data"), DATABASE_PATH: join(root, "app.db"), PORT: "3016", HOST: "127.0.0.1", LOG_LEVEL: "silent",
      CORS_ORIGIN: "http://localhost:5173", WEB_BASE_URL: "http://localhost:5180", LLM_ENABLE_MOCK: "true",
      LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", WORKER_ENABLED: "false", FAKE_STAGE_DELAY_MS: "0",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    });
    const app = buildApp({ config });
    await app.ready();
    await app.close();
    // Only index.ts (the real entry, after listen) calls warmPreviewRuntime, so the builder leaves the state alone.
    expect(previewWarmState()).toBe("idle");
  });
  it("a failing adapter load resolves with ok=false and never throws", async () => {
    const result = await warmPreviewRuntime(async () => { throw new Error("adapter boom"); });
    expect(result).toMatchObject({ ok: false, reason: "adapter boom" });
    expect(previewWarmState()).toBe("failed");
  });

  it("a successful load marks the runtime ready", async () => {
    const result = await warmPreviewRuntime(async () => ({ launch: async () => { throw new Error("not launched in test"); } }) as never);
    expect(result.ok).toBe(true);
    expect(previewWarmState()).toBe("ready");
  });

});
