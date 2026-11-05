import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NOT_ENOUGH_LEARNING_DATA,
  YOUTUBE_FULL_SCOPE,
  type NotificationEvent,
} from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig } from "../src/lib/config.js";
import { AppError } from "../src/lib/errors.js";
import {
  buildFeatureRows,
  isWeeklyInsightDue,
  MIN_SCORED_VIDEOS,
  shouldSwitchTitle,
  validateRecommendations,
  type LearningSource,
  type MetricSnapshot,
} from "../src/learning/features.js";
import { LearningService } from "../src/learning/learningService.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { saveAppLlmSettings } from "../src/providers/llm/settings.js";
import { scriptPrompt } from "../src/stages/script/prompt.js";
import { buildTopicSuggestPrompt } from "../src/services/topicService.js";
import type { Project } from "@vg/shared";

const root = mkdtempSync(join(tmpdir(), "vg-learning-"));

let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let clock = new Date("2026-11-02T01:00:00.000Z");
let service: LearningService;
let notes: NotificationEvent[];
let titleUpdates: Array<{ accountId: string; videoId: string; title: string }>;

beforeEach(() => {
  const dir = join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const database = openDatabase(join(dir, "app.db"));
  sqlite = database.sqlite;
  migrateDatabase(database.db, undefined, database.sqlite);
  const config = parseConfig({
    DATA_DIR: dir,
    DATABASE_PATH: join(dir, "app.db"),
    LLM_ENABLE_MOCK: "true",
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
  });
  saveAppLlmSettings(sqlite, { default: { provider: "mock", model: "mock-v1" } });
  notes = [];
  titleUpdates = [];
  clock = new Date("2026-11-02T01:00:00.000Z");
  service = new LearningService({
    sqlite,
    llm: new LlmProviderRegistry(config),
    notifications: { notify: async (event) => { notes.push(event); } },
    updateYoutubeTitle: async (input) => { titleUpdates.push(input); },
    now: () => clock,
  });
});

afterEach(() => {
  sqlite.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function snap(publishedAt: string, plusHours: number, views: number): MetricSnapshot {
  return {
    fetchedAt: new Date(Date.parse(publishedAt) + plusHours * 3600_000).toISOString(),
    views,
    likes: Math.round(views / 10),
    comments: 1,
    shares: 1,
    avgViewPct: 40,
    subscribersGained: 2,
  };
}

function source(partial: Partial<LearningSource> & Pick<LearningSource, "publicationId" | "platform" | "publishedAt" | "snapshots">): LearningSource {
  return {
    timeZone: "Asia/Ho_Chi_Minh",
    topicTitle: partial.topicTitle ?? "Chủ đề",
    hook: partial.hook ?? "Câu mở.",
    durationSec: partial.durationSec ?? 120,
    sceneCount: 4,
    voice: "vi-VN-HoaiMyNeural",
    musicOn: true,
    aspect: "16:9",
    language: "vi",
    template: "documentary",
    title: partial.title ?? "Tiêu đề video",
    hashtagCount: 2,
    profit: partial.profit ?? null,
    ...partial,
  };
}

describe("feature rows", () => {
  it("picks the snapshots closest to 72h and 7d and scores each platform on its own", () => {
    const published = "2026-01-01T00:00:00.000Z";
    const rows = buildFeatureRows([
      source({
        publicationId: "11111111-1111-4111-8111-111111111111",
        platform: "youtube",
        publishedAt: published,
        snapshots: [snap(published, 1, 9), snap(published, 73, 72), snap(published, 24 * 8, 700)],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.views72h).toBe(72);
    expect(rows[0]?.views7d).toBe(700);
    expect(buildFeatureRows([
      source({
        publicationId: "22222222-2222-4222-8222-222222222222",
        platform: "youtube",
        publishedAt: published,
        snapshots: [snap(published, 1, 9)],
      }),
    ])).toHaveLength(0);

    const youtube = [10, 20, 30, 40].map((views, index) => source({
      publicationId: `aaaaaaa${index}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      platform: "youtube",
      publishedAt: published,
      snapshots: [snap(published, 80, views)],
    }));
    const tiktok = [1000, 2000, 3000, 4000].map((views, index) => source({
      publicationId: `bbbbbbb${index}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      platform: "tiktok",
      publishedAt: published,
      snapshots: [snap(published, 80, views)],
    }));
    const scored = buildFeatureRows([...youtube, ...tiktok]);
    expect(scored.filter((row) => row.score != null)).toHaveLength(8);
    const lowYoutube = scored.find((row) => row.platform === "youtube" && row.views7d === 10)!;
    const lowTiktok = scored.find((row) => row.platform === "tiktok" && row.views7d === 1000)!;
    const highYoutube = scored.find((row) => row.platform === "youtube" && row.views7d === 40)!;
    const highTiktok = scored.find((row) => row.platform === "tiktok" && row.views7d === 4000)!;
    expect(lowYoutube.score).toBe(lowTiktok.score);
    expect(highYoutube.score).toBe(highTiktok.score);
    expect(highYoutube.score!).toBeGreaterThan(lowYoutube.score!);
    expect(scored.length).toBeGreaterThanOrEqual(MIN_SCORED_VIDEOS);
  });

  it("drops unsupported publish times and clamps duration onto the observed range", () => {
    const stats = {
      hourBuckets: [
        { hour: 3, count: 4, medianScore: 20 },
        { hour: 19, count: 4, medianScore: 80 },
      ],
      supportedHours: [19],
      durationBuckets: [],
      observedDuration: { min: 120, max: 120 },
      topicClusters: [],
      overallMedian: 50,
    };
    const validated = validateRecommendations({
      directionAddendum: "x".repeat(800),
      preferredDurationSec: { min: 60, max: 180 },
      publishTimes: ["19:00", "03:00", "nope"],
      topicAngles: ["một", "hai"],
      avoid: ["giật gân"],
    }, stats);
    expect(validated.publishTimes).toEqual(["19:00"]);
    expect(validated.preferredDurationSec).toEqual({ min: 120, max: 120 });
    expect(validated.directionAddendum).toHaveLength(600);
    expect(validateRecommendations({
      preferredDurationSec: { min: 10, max: 20 },
    }, stats).preferredDurationSec).toEqual({ min: 120, max: 120 });
  });

  it("treats Monday 08:00 as the weekly slot and stretches economy to 14 days", () => {
    const monday = new Date("2026-11-02T01:00:00.000Z");
    expect(isWeeklyInsightDue({
      now: monday,
      timeZone: "Asia/Ho_Chi_Minh",
      lastInsightAt: null,
      economy: false,
    })).toBe(true);
    expect(isWeeklyInsightDue({
      now: new Date("2026-11-02T00:30:00.000Z"),
      timeZone: "Asia/Ho_Chi_Minh",
      lastInsightAt: null,
      economy: false,
    })).toBe(false);
    expect(isWeeklyInsightDue({
      now: new Date("2026-11-03T01:00:00.000Z"),
      timeZone: "Asia/Ho_Chi_Minh",
      lastInsightAt: null,
      economy: false,
    })).toBe(false);
    expect(isWeeklyInsightDue({
      now: new Date("2026-11-09T01:00:00.000Z"),
      timeZone: "Asia/Ho_Chi_Minh",
      lastInsightAt: monday.toISOString(),
      economy: true,
    })).toBe(false);
    expect(isWeeklyInsightDue({
      now: new Date("2026-11-16T01:00:00.000Z"),
      timeZone: "Asia/Ho_Chi_Minh",
      lastInsightAt: monday.toISOString(),
      economy: true,
    })).toBe(true);
  });
});

describe("title switch rule", () => {
  it("switches only below the median after 48h and never twice", () => {
    expect(shouldSwitchTitle({
      ageMs: 47 * 3600_000,
      viewsPerHour: 1,
      medianViewsPerHour: 10,
      alreadyChecked: false,
    })).toBe("wait");
    expect(shouldSwitchTitle({
      ageMs: 49 * 3600_000,
      viewsPerHour: 1,
      medianViewsPerHour: 10,
      alreadyChecked: false,
    })).toBe("switch");
    expect(shouldSwitchTitle({
      ageMs: 49 * 3600_000,
      viewsPerHour: 20,
      medianViewsPerHour: 10,
      alreadyChecked: false,
    })).toBe("keep");
    expect(shouldSwitchTitle({
      ageMs: 49 * 3600_000,
      viewsPerHour: 1,
      medianViewsPerHour: 10,
      alreadyChecked: true,
    })).toBe("keep");
  });
});

function seedProfile(options: {
  mode?: string;
  autoPublish?: boolean;
  budgetMode?: string;
  duration?: number;
  scopes?: string[];
  titleAb?: boolean;
} = {}): { profileId: string; accountId: string } {
  const profileId = randomUUID();
  const accountId = randomUUID();
  const ts = "2026-10-01T00:00:00.000Z";
  sqlite.prepare(
    `INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, automation, avatar_path, color, archived_at, created_at, updated_at)
     VALUES (?, ?, '', ?, 'vi', ?, NULL, ?, NULL, ?, NULL, '#3B82F6', NULL, ?, ?)`,
  ).run(
    profileId,
    `P-${profileId.slice(0, 8)}`,
    "Định hướng gốc",
    JSON.stringify({
      platform: "youtube",
      targetDurationSec: options.duration ?? 90,
      budget: { mode: options.budgetMode ?? "BALANCED" },
      language: "vi",
    }),
    JSON.stringify({ platformPack: "auto", customRules: [] }),
    JSON.stringify({ timezone: "Asia/Ho_Chi_Minh", publishTimes: ["08:00"], enabled: false }),
    ts,
    ts,
  );
  sqlite.prepare(
    `UPDATE profiles SET learning_mode = ?, title_ab_test = ? WHERE id = ?`,
  ).run(options.mode ?? "suggest", options.titleAb ? 1 : 0, profileId);
  sqlite.prepare(
    `INSERT INTO platform_accounts (
      id, profile_id, platform, display_name, handle, external_id, format, enabled,
      connection, connection_error, last_checked_at, publish_settings, created_at, updated_at
    ) VALUES (?, ?, 'youtube', 'YT', '@yt', 'chan', 'landscape', 1, 'CONNECTED', NULL, NULL, ?, ?, ?)`,
  ).run(
    accountId,
    profileId,
    JSON.stringify({ visibility: "public", autoPublish: Boolean(options.autoPublish) }),
    ts,
    ts,
  );
  if (options.scopes) {
    sqlite.prepare(
      `INSERT INTO platform_credentials (account_id, ciphertext, iv, auth_tag, scopes, expires_at, updated_at)
       VALUES (?, 'x', 'y', 'z', ?, NULL, ?)`,
    ).run(accountId, JSON.stringify(options.scopes), ts);
  }
  return { profileId, accountId };
}

function seedScoredVideo(input: {
  profileId: string;
  accountId: string;
  publishedAt: string;
  views: number;
  externalId?: string;
  titles?: string[];
}): string {
  const projectId = randomUUID();
  const renderId = randomUUID();
  const publicationId = randomUUID();
  const ts = input.publishedAt;
  sqlite.prepare(
    `INSERT INTO projects (
      id, title, description, topic, mode, run_mode, settings, status, stage,
      thumbnail_path, duration_sec, version, profile_id, created_at, updated_at, archived_at
    ) VALUES (?, 'Tiêu đề', '', 'Chuyện lịch sử ngắn', 'ASSISTED', 'ASSISTED', ?, 'COMPLETED', 'DONE', NULL, 120, 1, ?, ?, ?, NULL)`,
  ).run(projectId, JSON.stringify({ language: "vi", aspectRatio: "16:9", style: "documentary" }), input.profileId, ts, ts);
  sqlite.prepare(
    `INSERT INTO renders (
      id, project_id, input_hash, status, output_path, credits_path, srt_path,
      duration_sec, size_bytes, width, height, report, created_at, version, note, pinned, deleted_at,
      review_thread_id, metadata_snapshot, aspect_ratio, variant_of
    ) VALUES (?, ?, 'h', 'DONE', '/tmp/v.mp4', NULL, NULL, 120, 10, 1920, 1080, '{}', ?, 1, NULL, 0, NULL, NULL, NULL, NULL, NULL)`,
  ).run(renderId, projectId, ts);
  sqlite.prepare(
    `INSERT INTO publications (
      id, project_id, render_id, account_id, status, visibility_requested, visibility_used,
      guardrail_reason, scheduled_for, external_id, external_url, attempts, last_error, progress,
      warnings, latest_metrics, metrics_synced_at, created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, 'PUBLISHED', 'public', 'public', NULL, NULL, ?, 'https://youtu.be/x', 1, NULL, 100, '[]', ?, ?, ?, ?, ?)`,
  ).run(
    publicationId,
    projectId,
    renderId,
    input.accountId,
    input.externalId ?? `vid-${publicationId.slice(0, 8)}`,
    JSON.stringify({ views: input.views }),
    ts,
    ts,
    ts,
    input.publishedAt,
  );
  const at72 = new Date(Date.parse(input.publishedAt) + 73 * 3600_000).toISOString();
  const at7 = new Date(Date.parse(input.publishedAt) + 7 * 24 * 3600_000).toISOString();
  for (const [fetched, views] of [[at72, Math.round(input.views / 2)], [at7, input.views]] as const) {
    sqlite.prepare(
      `INSERT INTO publication_metrics_snapshots (
        id, publication_id, fetched_at, views, likes, comments, shares, saves,
        watch_time_sec, avg_view_duration_sec, avg_view_pct, subscribers_gained, reach, raw
      ) VALUES (?, ?, ?, ?, ?, 1, 1, NULL, NULL, NULL, 40, 1, NULL, '{}')`,
    ).run(randomUUID(), publicationId, fetched, views, Math.round(views / 10));
  }
  if (input.titles) {
    sqlite.prepare(
      `INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at)
       VALUES (?, 'h', ?, NULL, 'CODE', ?, ?)`,
    ).run(projectId, JSON.stringify({
      titles: input.titles,
      description: "mô tả",
      tags: [],
      hashtags: ["#a", "#b"],
      thumbnailText: [],
    }), ts, ts);
  }
  return publicationId;
}

function seedPair(profile: { profileId: string; accountId: string }, views: number[], hour: "19" | "03"): void {
  views.forEach((value, index) => {
    const publishedAt = hour === "19"
      ? `2026-10-0${index + 1}T12:00:00.000Z`
      : `2026-10-0${index + 1}T20:00:00.000Z`;
    seedScoredVideo({ ...profile, publishedAt, views: value });
  });
}

describe("learning service", () => {
  it("does not call the LLM when fewer than 8 videos are scored", async () => {
    const profile = seedProfile();
    seedPair(profile, [10, 20], "19");
    const result = await service.run(profile.profileId, "manual");
    expect(result).toMatchObject({ status: "insufficient", message: NOT_ENOUGH_LEARNING_DATA, insight: null });
    const cache = sqlite.prepare("SELECT COUNT(*) AS count FROM llm_cache").get() as { count: number };
    expect(cache.count).toBe(0);
  });

  it("stores a suggestion without applying, then auto-applies only the allowed fields", async () => {
    const suggest = seedProfile({ mode: "suggest" });
    seedPair(suggest, [1000, 1100, 1200, 1300], "19");
    seedPair(suggest, [10, 20, 30, 40], "03");
    const stored = await service.run(suggest.profileId, "manual");
    expect(stored.status).toBe("stored");
    expect(stored.insight?.status).toBe("new");
    expect(stored.insight?.recommendations.publishTimes).toEqual(["19:00"]);
    const row = sqlite.prepare("SELECT direction, learned_notes, automation, default_brief FROM profiles WHERE id = ?")
      .get(suggest.profileId) as { direction: string; learned_notes: string; automation: string; default_brief: string };
    expect(row.direction).toBe("Định hướng gốc");
    expect(row.learned_notes).toBe("");
    expect(JSON.parse(row.automation).publishTimes).toEqual(["08:00"]);

    const auto = seedProfile({ mode: "auto" });
    seedPair(auto, [1000, 1100, 1200, 1300], "19");
    seedPair(auto, [10, 20, 30, 40], "03");
    const applied = await service.run(auto.profileId, "manual");
    expect(applied.status).toBe("applied");
    const after = sqlite.prepare(
      "SELECT direction, learned_notes, learned_hints, automation, default_brief FROM profiles WHERE id = ?",
    ).get(auto.profileId) as {
      direction: string;
      learned_notes: string;
      learned_hints: string;
      automation: string;
      default_brief: string;
    };
    expect(after.direction).toBe("Định hướng gốc");
    expect(after.learned_notes).toContain("hook ngắn");
    expect(JSON.parse(after.learned_hints).topicAngles).toEqual(["kể một chi tiết cụ thể"]);
    expect(JSON.parse(after.learned_hints).avoid ?? []).toEqual([]);
    expect(JSON.parse(after.automation).publishTimes).toEqual(["08:00"]);
    expect(JSON.parse(after.default_brief).targetDurationSec).toBe(120);
    const log = sqlite.prepare("SELECT message FROM automation_log WHERE profile_id = ?").get(auto.profileId) as { message: string };
    expect(log.message).toContain("Đã cập nhật bài học cho hồ sơ");
    expect(notes.some((event) => event.kind === "automation_warning" && event.message.includes("Đã cập nhật bài học cho hồ sơ"))).toBe(true);

    const undone = service.undo(auto.profileId);
    expect(undone.learnedNotes).toBe("");
    expect(undone.canUndo).toBe(false);
    const restored = sqlite.prepare("SELECT direction, default_brief FROM profiles WHERE id = ?").get(auto.profileId) as {
      direction: string;
      default_brief: string;
    };
    expect(restored.direction).toBe("Định hướng gốc");
    expect(JSON.parse(restored.default_brief).targetDurationSec).toBe(90);
  });

  it("applies publish times in auto mode only when an account auto-publishes", async () => {
    const profile = seedProfile({ mode: "auto", autoPublish: true });
    seedPair(profile, [1000, 1100, 1200, 1300], "19");
    seedPair(profile, [10, 20, 30, 40], "03");
    await service.run(profile.profileId, "manual");
    const automation = sqlite.prepare("SELECT automation FROM profiles WHERE id = ?").get(profile.profileId) as { automation: string };
    expect(JSON.parse(automation.automation).publishTimes).toEqual(["19:00"]);
  });

  it("rate-limits manual runs to once per hour and runs the weekly job on Monday", async () => {
    const profile = seedProfile();
    seedPair(profile, [1000, 1100, 1200, 1300], "19");
    seedPair(profile, [10, 20, 30, 40], "03");
    clock = new Date("2026-11-05T02:00:00.000Z");
    await service.run(profile.profileId, "manual");
    await expect(service.run(profile.profileId, "manual")).rejects.toMatchObject({
      statusCode: 429,
      code: "INSIGHT_RATE_LIMITED",
    });
    clock = new Date(clock.getTime() + 61 * 60_000);
    const again = await service.run(profile.profileId, "manual");
    expect(again.insight).toBeTruthy();

    const weekly = seedProfile();
    seedPair(weekly, [1000, 1100, 1200, 1300], "19");
    seedPair(weekly, [10, 20, 30, 40], "03");
    clock = new Date("2026-11-02T00:30:00.000Z");
    expect((await service.run(weekly.profileId, "weekly")).status).toBe("skipped");
    clock = new Date("2026-11-02T01:00:00.000Z");
    expect((await service.run(weekly.profileId, "weekly")).status).toBe("stored");
    expect((await service.run(weekly.profileId, "weekly")).status).toBe("skipped");

    const economy = seedProfile({ budgetMode: "ECO" });
    seedPair(economy, [1000, 1100, 1200, 1300], "19");
    seedPair(economy, [10, 20, 30, 40], "03");
    clock = new Date("2026-11-02T01:00:00.000Z");
    expect((await service.run(economy.profileId, "weekly")).status).toBe("stored");
    for (let index = 0; index < 3; index += 1) {
      seedScoredVideo({
        profileId: economy.profileId,
        accountId: economy.accountId,
        publishedAt: `2026-10-1${index}T12:00:00.000Z`,
        views: 2000 + index,
      });
    }
    clock = new Date("2026-11-09T01:00:00.000Z");
    expect((await service.run(economy.profileId, "weekly")).status).toBe("skipped");
    clock = new Date("2026-11-16T01:00:00.000Z");
    expect((await service.run(economy.profileId, "weekly")).status).toBe("stored");
  });

  it("puts learned notes in the topic and script prompts without changing direction", () => {
    const profile = seedProfile();
    sqlite.prepare("UPDATE profiles SET learned_notes = ? WHERE id = ?").run("Giữ câu mở ngắn.", profile.profileId);
    const direction = sqlite.prepare("SELECT direction FROM profiles WHERE id = ?").get(profile.profileId) as { direction: string };
    expect(direction.direction).toBe("Định hướng gốc");
    const project = {
      id: randomUUID(),
      title: "T",
      description: "",
      topic: "Chuyện",
      mode: "ASSISTED",
      status: "DRAFT",
      stage: "SCRIPT",
      version: 1,
      profileId: profile.profileId,
      settings: {
        language: "vi",
        targetDurationSec: 90,
        platform: "youtube",
        style: "documentary",
        tone: "neutral",
        audience: "general",
        aspectRatio: "16:9",
      },
      createdAt: clock.toISOString(),
      updatedAt: clock.toISOString(),
    } as unknown as Project;
    const script = scriptPrompt(project, undefined, 150, undefined, direction.direction, "Giữ câu mở ngắn.");
    expect(script.prompt).toContain("Bài học từ số liệu:\nGiữ câu mở ngắn.");
    expect(script.prompt).toContain("Định hướng kênh:\nĐịnh hướng gốc");
    const topic = buildTopicSuggestPrompt({
      direction: direction.direction,
      learnedNotes: "Giữ câu mở ngắn.",
      language: "vi",
      hint: "",
      count: 3,
      pastTopics: [],
      topicAngles: ["chi tiết cụ thể"],
      avoid: ["giật gân"],
    });
    expect(topic.prompt).toContain("Bài học từ số liệu:\nGiữ câu mở ngắn.");
    expect(topic.prompt).toContain("chi tiết cụ thể");
    expect(topic.prompt).toContain("giật gân");
    expect(direction.direction).toBe("Định hướng gốc");
  });

  it("switches a weak YouTube title once after 48h and hides the toggle without the full scope", async () => {
    const hidden = seedProfile();
    expect(service.getView(hidden.profileId).titleAbAvailable).toBe(false);
    expect(service.getView(hidden.profileId).titleAbReason).toContain("youtube");
    expect(() => service.saveSettings(hidden.profileId, { titleAbTest: true })).toThrow(AppError);

    const profile = seedProfile({
      titleAb: true,
      scopes: [YOUTUBE_FULL_SCOPE],
    });
    expect(service.getView(profile.profileId).titleAbAvailable).toBe(true);
    const weak = seedScoredVideo({
      profileId: profile.profileId,
      accountId: profile.accountId,
      publishedAt: "2026-10-01T12:00:00.000Z",
      views: 10,
      externalId: "weak-vid",
      titles: ["Tiêu đề A", "Tiêu đề B"],
    });
    seedScoredVideo({
      profileId: profile.profileId,
      accountId: profile.accountId,
      publishedAt: "2026-09-01T12:00:00.000Z",
      views: 5000,
      externalId: "strong-vid",
    });
    clock = new Date(Date.parse("2026-10-01T12:00:00.000Z") + 47 * 3600_000);
    await service.tick();
    expect(titleUpdates).toHaveLength(0);
    clock = new Date(Date.parse("2026-10-01T12:00:00.000Z") + 49 * 3600_000);
    await service.tick();
    expect(titleUpdates).toEqual([{ accountId: profile.accountId, videoId: "weak-vid", title: "Tiêu đề B" }]);
    await service.tick();
    expect(titleUpdates).toHaveLength(1);
    const experiment = sqlite.prepare("SELECT status, winner FROM title_experiments WHERE publication_id = ?")
      .get(weak) as { status: string; winner: string };
    expect(experiment).toEqual({ status: "switched", winner: "B" });

    const strong = seedProfile({ titleAb: true, scopes: [YOUTUBE_FULL_SCOPE] });
    seedScoredVideo({
      profileId: strong.profileId,
      accountId: strong.accountId,
      publishedAt: "2026-10-01T12:00:00.000Z",
      views: 9000,
      externalId: "keep-vid",
      titles: ["Giữ A", "Đổi B"],
    });
    seedScoredVideo({
      profileId: strong.profileId,
      accountId: strong.accountId,
      publishedAt: "2026-09-01T12:00:00.000Z",
      views: 10,
      externalId: "other-vid",
    });
    const before = titleUpdates.length;
    clock = new Date(Date.parse("2026-10-01T12:00:00.000Z") + 49 * 3600_000);
    await service.tick();
    expect(titleUpdates).toHaveLength(before);
    const kept = sqlite.prepare(
      "SELECT status, winner FROM title_experiments WHERE external_id = 'keep-vid'",
    ).get() as { status: string; winner: string };
    expect(kept).toEqual({ status: "kept", winner: "A" });
  });
});
