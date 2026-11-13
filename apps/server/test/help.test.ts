import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { assertGuidePage, readGuideMarkdown, searchGuide } from "../src/help/loadGuide.js";
import { parseConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-help-test-"));
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function createApp() {
  const dataDir = join(root, "data");
  const config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
  });
  const app = buildApp({ testActor,  config });
  apps.push(app);
  return app;
}

describe("help guide", () => {
  it("serves a whitelisted page and refuses traversal", async () => {
    const app = createApp();
    const ok = await app.inject({ method: "GET", url: "/api/help/ho-so" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().markdown).toContain("{#danh-sach-ho-so}");

    const missing = await app.inject({ method: "GET", url: "/api/help/khong-co-trang" });
    expect(missing.statusCode).toBe(404);

    const escaped = await app.inject({ method: "GET", url: "/api/help/..%2F..%2Fpackage.json" });
    expect([400, 404]).toContain(escaped.statusCode);
    expect(escaped.body).not.toContain("video-generator");

    expect(() => assertGuidePage("..")).toThrow(/không hợp lệ/i);
    expect(() => assertGuidePage("../package.json")).toThrow(/không hợp lệ/i);
    expect(() => readGuideMarkdown("../package.json")).toThrow(/không hợp lệ/i);
  });

  it("ranks a matching guide section first", async () => {
    const found = searchGuide("kết nối Telegram");
    expect(found.sections[0]?.anchor).toBe("telegram");
    expect(found.sections[0]?.title).toMatch(/Telegram/);

    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/help/search?q=" + encodeURIComponent("quota"),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { sections: Array<{ anchor: string; title: string }> };
    expect(body.sections[0]?.anchor).toBe("quota");
    expect(body.sections[0]?.title.toLowerCase()).toContain("quota");
  });
});
