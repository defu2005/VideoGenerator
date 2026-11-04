import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scriptPrompt } from "../src/stages/script/prompt.js";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import type { PlatformAccount, ProfileDetail, Project } from "@vg/shared";

const root = mkdtempSync(join(tmpdir(), "vg-profiles-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "profiles.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
  });
});

beforeEach(() => {
  const dataDir = join(root, `data-${randomUUID()}`);
  config = {
    ...config,
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
  };
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function createProfile(payload: Record<string, unknown> = { name: `Hồ sơ ${randomUUID().slice(0, 8)}` }): Promise<ProfileDetail> {
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles",
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json<ProfileDetail>();
}

describe("profile API", () => {
  it("supports profile CRUD, archive, and account lifecycle", async () => {
    const created = await createProfile({
      name: "Lịch sử 5 phút",
      description: "Kênh lịch sử ngắn",
      direction: "Kể chuyện lịch sử Việt Nam ngắn gọn, tránh spoiler kết cục.",
      language: "vi",
      color: "#C45C26",
      defaultBrief: {
        platform: "youtube",
        style: "storytelling",
        tone: "dramatic",
        targetDurationSec: 180,
        mode: "ASSISTED",
        autoRender: false,
      },
    });
    expect(created.name).toBe("Lịch sử 5 phút");
    expect(created.direction).toContain("Việt Nam");
    expect(created.defaultBrief.platform).toBe("youtube");
    expect(created.accounts).toEqual([]);

    const listed = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.some((item: { id: string }) => item.id === created.id)).toBe(true);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/profiles/${created.id}`,
      payload: { description: "Cập nhật mô tả" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<ProfileDetail>().description).toBe("Cập nhật mô tả");

    const yt = await app.inject({
      method: "POST",
      url: `/api/profiles/${created.id}/accounts`,
      payload: { platform: "youtube", displayName: "Lịch sử 5 phút", handle: "@lichsu5p" },
    });
    expect(yt.statusCode).toBe(201);
    const youtubeAccount = yt.json<PlatformAccount>();
    expect(youtubeAccount.format).toBe("landscape");
    expect(youtubeAccount.connection).toBe("NOT_CONNECTED");
    expect(youtubeAccount.publishSettings.autoPublish).toBe(false);

    const tt = await app.inject({
      method: "POST",
      url: `/api/profiles/${created.id}/accounts`,
      payload: { platform: "tiktok", displayName: "Lịch sử 5 phút Shorts" },
    });
    expect(tt.statusCode).toBe(201);
    expect(tt.json<PlatformAccount>().format).toBe("vertical");

    const updatedAccount = await app.inject({
      method: "PATCH",
      url: `/api/profiles/${created.id}/accounts/${youtubeAccount.id}`,
      payload: { publishSettings: { visibility: "unlisted", autoPublish: false } },
    });
    expect(updatedAccount.statusCode).toBe(200);
    expect(updatedAccount.json<PlatformAccount>().publishSettings.visibility).toBe("unlisted");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/profiles/${created.id}/accounts/${tt.json<PlatformAccount>().id}`,
    });
    expect(removed.statusCode).toBe(204);

    // Simulate connected account → delete must 409
    const Database = (await import("better-sqlite3")).default;
    const sqlite = new Database(config.DATABASE_PATH);
    sqlite.prepare("UPDATE platform_accounts SET connection = ? WHERE id = ?").run("CONNECTED", youtubeAccount.id);
    sqlite.close();

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/profiles/${created.id}/accounts/${youtubeAccount.id}`,
    });
    expect(blocked.statusCode).toBe(409);

    const archived = await app.inject({
      method: "POST",
      url: `/api/profiles/${created.id}/archive`,
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<ProfileDetail>().archivedAt).toBeTruthy();

    const activeList = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(activeList.json().items.some((item: { id: string }) => item.id === created.id)).toBe(false);

    const withArchived = await app.inject({ method: "GET", url: "/api/profiles?includeArchived=true" });
    expect(withArchived.json().items.some((item: { id: string }) => item.id === created.id)).toBe(true);

    const unarchived = await app.inject({
      method: "POST",
      url: `/api/profiles/${created.id}/unarchive`,
    });
    expect(unarchived.statusCode).toBe(200);
    expect(unarchived.json<ProfileDetail>().archivedAt).toBeNull();
  });

  it("creates a project from a profile with inherited settings and aspect from main format", async () => {
    const profile = await createProfile({
      name: `Profile ${randomUUID().slice(0, 8)}`,
      language: "vi",
      direction: "Góc nhìn dân gian, tránh huyền thoại không kiểm chứng.",
      defaultBrief: {
        platform: "youtube",
        style: "documentary",
        tone: "serious",
        audience: "students",
        targetDurationSec: 240,
        aspectRatio: "16:9",
        mode: "AUTO",
        autoRender: true,
      },
      guidelines: { platformPack: "youtube", customRules: ["Không spoiler"] },
      voice: { voice: "vi-VN-HoaiMyNeural", rate: "+0%" },
    });

    await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/accounts`,
      payload: { platform: "tiktok", displayName: "Shorts", format: "vertical" },
    });
    await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/accounts`,
      payload: { platform: "youtube", displayName: "Main", format: "landscape" },
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        topic: "Trận Bạch Đằng năm 938",
        profileId: profile.id,
        // Request override wins over profile tone
        tone: "inspiring",
      },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json<Project>();
    expect(project.profileId).toBe(profile.id);
    expect(project.mode).toBe("AUTO");
    expect(project.settings.style).toBe("documentary");
    expect(project.settings.tone).toBe("inspiring");
    expect(project.settings.autoRender).toBe(true);
    expect(project.settings.aspectRatio).toBe("16:9");
    expect(project.settings.voice?.voice).toBe("vi-VN-HoaiMyNeural");
    expect(project.settings.guidelines?.customRules).toContain("Không spoiler");

    const verticalOnly = await createProfile({
      name: `Vertical ${randomUUID().slice(0, 8)}`,
      defaultBrief: { platform: "tiktok", aspectRatio: "16:9" },
    });
    await app.inject({
      method: "POST",
      url: `/api/profiles/${verticalOnly.id}/accounts`,
      payload: { platform: "tiktok", displayName: "TT" },
    });
    const shortProject = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Short topic", profileId: verticalOnly.id },
    });
    expect(shortProject.json<Project>().settings.aspectRatio).toBe("9:16");

    const filtered = await app.inject({
      method: "GET",
      url: `/api/projects?profileId=${profile.id}`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items.every((item: Project) => item.profileId === profile.id)).toBe(true);
    expect(filtered.json().items.some((item: Project) => item.id === project.id)).toBe(true);
  });

  it("injects Định hướng kênh into the script prompt when the project has a profile", async () => {
    const profile = await createProfile({
      name: `Dir ${randomUUID().slice(0, 8)}`,
      direction: "Định hướng đặc biệt cho kênh lịch sử ngắn.",
    });
    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Chủ đề thử", profileId: profile.id },
    });
    const project = projectRes.json<Project>();
    const withDirection = scriptPrompt(project, undefined, 150, undefined, profile.direction);
    expect(withDirection.prompt).toContain("Định hướng kênh:");
    expect(withDirection.prompt).toContain("Định hướng đặc biệt cho kênh lịch sử ngắn.");

    const without = scriptPrompt({ ...project, profileId: null }, undefined, 150, undefined, undefined);
    expect(without.prompt).not.toContain("Định hướng kênh:");

    const promptApi = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/prompts/SCRIPT`,
    });
    expect(promptApi.statusCode).toBe(200);
    expect(promptApi.json().user).toContain("Định hướng kênh:");
    expect(promptApi.json().user).toContain("Định hướng đặc biệt cho kênh lịch sử ngắn.");
  });
});
