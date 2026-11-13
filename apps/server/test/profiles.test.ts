import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { scriptPrompt } from "../src/stages/script/prompt.js";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { DEFAULT_NOTIFICATION_SETTINGS, marketPack, snapshotKnowledge, type PlatformAccount, type ProfileDetail, type Project } from "@vg/shared";
import { buildTopicSuggestPrompt } from "../src/services/topicService.js";
import { defaultVoiceFor } from "../src/lib/defaultVoice.js";
import { buildSystemPrompt } from "../src/assistant/loop.js";
import { ASSISTANT_TOOLS, periodToRange, type AssistantToolContext } from "../src/assistant/tools.js";
import { openDatabase } from "../src/db/client.js";
import { getNotificationTimezone, saveNotificationSettings } from "../src/settings/notifications.js";
import { KnowledgeService } from "../src/knowledge/service.js";

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
  app = buildApp({ testActor,  config });
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
  it("previews and selectively applies market defaults while preserving manual edits and older projects", async () => {
    const profile = await createProfile({ name: "Market preview", automation: { videosPerDay: 2 } });
    const path = `/api/profiles/${profile.id}`;
    const createProject = async () => {
      const result = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Market fixture", profileId: profile.id } });
      expect(result.statusCode).toBe(201);
      return result.json<Project>();
    };
    const old = await createProject();
    expect(old.settings.market).toBeUndefined();
    const account = await app.inject({ method: "POST", url: `${path}/accounts`, payload: { platform: "tiktok", displayName: "Test TikTok" } });
    expect(account.statusCode).toBe(201);
    const manual = await app.inject({ method: "PATCH", url: path, payload: { language: "fr" } });
    expect(manual.statusCode).toBe(200);
    const changedMarket = await app.inject({ method: "PATCH", url: path, payload: { market: "GB" } });
    expect(changedMarket.json<ProfileDetail>()).toMatchObject({ market: "GB", language: "fr",
      automation: { timezone: "Asia/Ho_Chi_Minh", publishTimes: ["19:00"] }, trendSettings: { region: "VN" } });
    const preview = await app.inject({ method: "GET", url: `${path}/market-defaults?code=GB` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().changes).toEqual(expect.arrayContaining([
      { field: "language", from: "fr", to: "en", recentlyEdited: true },
      { field: "publishTimes", from: ["19:00"], to: ["15:00", "23:00"], recentlyEdited: false },
    ]));
    const stale = await app.inject({ method: "POST", url: `${path}/apply-market-defaults`,
      payload: { code: "GB", fields: ["language"], previewToken: "0".repeat(64) } });
    expect(stale.statusCode).toBe(409);
    const applied = await app.inject({ method: "POST", url: `${path}/apply-market-defaults`,
      payload: { code: "GB", fields: ["timezone", "publishTimes", "trendSettings.region"], previewToken: preview.json().previewToken } });
    expect(applied.statusCode).toBe(200);
    expect(applied.json<ProfileDetail>()).toMatchObject({ market: "GB", language: "fr",
      automation: { timezone: "Europe/London", publishTimes: ["15:00", "23:00"] }, trendSettings: { region: "GB", language: "vi" } });
    const invalid = await app.inject({ method: "PATCH", url: path, payload: { market: "ZZ" } });
    expect(invalid.statusCode).toBe(400);
    const fresh = await createProject();
    expect(fresh.settings.market).toBe("GB");
    expect((await app.inject({ method: "GET", url: `/api/projects/${old.id}` })).json<Project>().settings.market).toBeUndefined();
  });

  it("seeds new profiles and warns about unavailable platforms without blocking the account", async () => {
    const gb = await createProfile({ name: "GB defaults", market: "GB", defaultBrief: { platform: "tiktok" } });
    expect(gb).toMatchObject({ market: "GB", language: "en", automation: { timezone: "Europe/London", publishTimes: ["15:00"] },
      trendSettings: { region: "GB", language: "en" } });
    const india = await createProfile({ name: "India warning", market: "IN" });
    const path = `/api/profiles/${india.id}/accounts`;
    const created = await app.inject({ method: "POST", url: path, payload: { platform: "tiktok", displayName: "Test TikTok" } });
    expect(created.statusCode).toBe(201);
    const account = created.json<PlatformAccount>();
    expect(account.marketWarning).toContain("chưa khả dụng");
    const detail = await app.inject({ method: "GET", url: `${path}/${account.id}/connection` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().marketWarning).toEqual(account.marketWarning);
    const market = await app.inject({ method: "GET", url: "/api/markets/GB" });
    expect(market.json()).toMatchObject({ pack: { code: "GB" }, defaults: { voiceLocale: "en-GB" } });
  });

  it("lists and uses a new market once its knowledge entry is accepted", async () => {
    await app.ready();
    const { sqlite } = openDatabase(config.DATABASE_PATH);
    try {
      const knowledge = new KnowledgeService(sqlite);
      const template = snapshotKnowledge("market.GB")!;
      const pack = { ...marketPack("GB")!, code: "NZ", name: { en: "New Zealand" },
        timezones: ["Pacific/Auckland"], defaultTimezone: "Pacific/Auckland" };
      const proposed = knowledge.propose({ ...template, id: "market.NZ", scope: { platforms: ["*"], markets: ["NZ"] }, value: pack }, "Test entry");
      expect((await app.inject({ method: "GET", url: "/api/markets" })).json().markets).toHaveLength(17);
      knowledge.decide(proposed.id, "accepted");
      expect((await app.inject({ method: "GET", url: "/api/markets" })).json().markets).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "NZ" }),
      ]));
      expect((await createProfile({ name: "Newly accepted fixture", market: "NZ" })).automation.timezone).toBe("Pacific/Auckland");
    } finally {
      sqlite.close();
    }
  });

  it("uses notification timezone in the assistant prompt and reporting tools", async () => {
    await app.ready();
    const { sqlite } = openDatabase(config.DATABASE_PATH);
    const now = new Date("2026-11-11T02:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      saveNotificationSettings(sqlite, { ...DEFAULT_NOTIFICATION_SETTINGS, timezone: "America/Los_Angeles" });
      const timezone = getNotificationTimezone(sqlite);
      expect(buildSystemPrompt({ now, timezone, profiles: [] })).toContain("11/10/2026");
      expect(periodToRange(1, now, "Pacific/Kiritimati")).toEqual({ from: "2026-11-11", to: "2026-11-11" });
      const getSummary = vi.fn();
      await ASSISTANT_TOOLS.finance_summary!.execute({ period: "7d" }, { sqlite, finance: { getSummary } } as unknown as AssistantToolContext);
      expect(getSummary).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-11-04", to: "2026-11-10" }));
      const info = await ASSISTANT_TOOLS.get_market_pack!.execute({ code: "GB" }, { sqlite } as AssistantToolContext);
      expect(info).toMatchObject({ pack: { code: "GB" }, defaults: { language: "en" } });
      expect(ASSISTANT_TOOLS.update_profile_direction!.risk).toBe("confirm");
    } finally {
      vi.useRealTimers();
      sqlite.close();
    }
  });

  it("uses market in script, topic and voice defaults only when present", () => {
    const project = { topic: "Market prompt", settings: { language: "en", aspectRatio: "16:9",
      targetDurationSec: 120, style: "documentary", tone: "neutral", audience: "general", platform: "youtube" } } as Project;
    expect(scriptPrompt(project).prompt).not.toContain("Audience country:");
    expect(scriptPrompt({ ...project, settings: { ...project.settings, market: "US" } }).prompt)
      .toContain("United States (US). Use local units, currency, examples and date format.");
    const input = { direction: "", language: "en", hint: "", count: 3, pastTopics: [], topicAngles: [], avoid: [] };
    expect(buildTopicSuggestPrompt(input).prompt).not.toContain("upcomingEvents");
    expect(buildTopicSuggestPrompt({ ...input, market: { pack: marketPack("GB")!, from: new Date("2026-11-11") } }).prompt)
      .toContain("St Andrew’s Day");
    const voices = [{ name: "US", language: "en-US" }, { name: "GB", language: "en-GB" }];
    expect(defaultVoiceFor("en-GB", voices, config, undefined, true)).toBe("GB");
    expect(defaultVoiceFor("en-GB", [voices[0]!], config, undefined, true)).toBe("US");
    expect(defaultVoiceFor("en", voices, config)).toBe(config.TTS_VOICE_EN);
  });

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

    // Wizard cleanup keeps a connected account. Explicit removal can delete it.
    const Database = (await import("better-sqlite3")).default;
    const sqlite = new Database(config.DATABASE_PATH);
    sqlite.prepare("UPDATE platform_accounts SET connection = ? WHERE id = ?").run("CONNECTED", youtubeAccount.id);
    sqlite.close();

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/profiles/${created.id}/accounts/${youtubeAccount.id}?unfinished=true`,
    });
    expect(blocked.statusCode).toBe(204);
    const kept = await app.inject({ method: "GET", url: `/api/profiles/${created.id}` });
    expect(kept.json().accounts).toContainEqual(expect.objectContaining({ id: youtubeAccount.id, connection: "CONNECTED" }));
    const explicitlyRemoved = await app.inject({
      method: "DELETE", url: `/api/profiles/${created.id}/accounts/${youtubeAccount.id}`,
    });
    expect(explicitlyRemoved.statusCode).toBe(204);

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
