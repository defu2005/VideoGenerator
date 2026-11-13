import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  PlatformAccount,
  ProfileDetail,
  ProfileTopic,
  Project,
  Publication,
} from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { listAutomationLogSync } from "../src/services/automationService.js";
import { updateTopicProductionSync } from "../src/services/topicService.js";

const root = mkdtempSync(join(tmpdir(), "vg-automation-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "auto.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    JOB_MAX_ATTEMPTS: "3",
    JOB_RETRY_BASE_MS: "10",
    FAKE_STAGE_DELAY_MS: "0",
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

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

async function createProfile(overrides: Record<string, unknown> = {}): Promise<ProfileDetail> {
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles",
    payload: {
      name: `Auto ${randomUUID().slice(0, 8)}`,
      direction: "Kênh lịch sử ngắn 5 phút",
      language: "vi",
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<ProfileDetail>();
}

async function enableAutomation(profileId: string, extra: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/profiles/${profileId}`,
    payload: {
      automation: {
        enabled: true,
        timezone: "Asia/Ho_Chi_Minh",
        videosPerDay: 2,
        publishTimes: ["19:00"],
        leadTimeHours: 6,
        autoSuggest: false,
        autoApproveTopics: false,
        ...extra,
      },
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json<ProfileDetail>();
}

async function addTopic(profileId: string, topic: string, status?: "PENDING" | "APPROVED") {
  const response = await app.inject({
    method: "POST",
    url: `/api/profiles/${profileId}/topics`,
    payload: { topic, ...(status ? { status } : {}) },
  });
  expect(response.statusCode).toBe(201);
  return response.json<ProfileTopic>();
}

async function listTopics(profileId: string) {
  const response = await app.inject({ method: "GET", url: `/api/profiles/${profileId}/topics` });
  expect(response.statusCode).toBe(200);
  return response.json<{ items: ProfileTopic[] }>().items;
}

function withFixedNow<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const fixed = new Date(iso);
  // @ts-expect-error test clock
  global.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed.toISOString());
      else super(...(args as [string]));
    }
    static now() { return fixed.getTime(); }
    static parse = RealDate.parse;
    static UTC = RealDate.UTC;
  };
  return fn().finally(() => {
    global.Date = RealDate;
  });
}

function seedRender(projectId: string): string {
  const renderId = randomUUID();
  const now = new Date().toISOString();
  const absolute = join(config.DATA_DIR, "projects", projectId, "renders", `${renderId}.mp4`);
  mkdirSync(join(config.DATA_DIR, "projects", projectId, "renders"), { recursive: true });
  writeFileSync(absolute, Buffer.from("fake-video"));
  sqlite().prepare(
    `INSERT INTO renders (
      id, project_id, input_hash, status, output_path, credits_path, srt_path,
      duration_sec, size_bytes, width, height, report, created_at, version, note, pinned, deleted_at,
      review_thread_id, metadata_snapshot, aspect_ratio, variant_of
    ) VALUES (?, ?, 'hash', 'DONE', ?, NULL, NULL, 30, 1000, 1920, 1080, ?, ?, 1, NULL, 0, NULL, NULL, NULL, NULL, NULL)`,
  ).run(renderId, projectId, absolute, JSON.stringify({ ok: true, issues: [] }), now);
  sqlite().prepare(
    `INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at)
     VALUES (?, 'hash', ?, NULL, 'CODE', ?, ?)`,
  ).run(
    projectId,
    JSON.stringify({
      titles: ["Tiêu đề auto"],
      description: "Mô tả",
      tags: ["history"],
      hashtags: ["#lichsu"],
      thumbnailText: ["Test"],
    }),
    now,
    now,
  );
  sqlite().prepare(`UPDATE projects SET status = 'COMPLETED', updated_at = ? WHERE id = ?`).run(now, projectId);
  return renderId;
}

describe("topic queue + suggest", () => {
  it("suggests topics as PENDING when autoApproveTopics is off", async () => {
    const profile = await createProfile();
    const response = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/topics/suggest`,
      payload: { hint: "Ai Cập", count: 3 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: ProfileTopic[]; rejectedDuplicates: number }>();
    expect(body.items).toHaveLength(3);
    expect(body.items.every((item) => item.status === "PENDING" && item.source === "LLM")).toBe(true);
  });

  it("auto-approves suggestions when autoApproveTopics is on", async () => {
    const profile = await createProfile({ automation: { autoApproveTopics: true } });
    const response = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/topics/suggest`,
      payload: { count: 2 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: ProfileTopic[] }>().items.every((item) => item.status === "APPROVED")).toBe(true);
  });

  it("keeps a past topic visible with an already-queued flag", async () => {
    const profile = await createProfile();
    await addTopic(profile.id, "Ai Cập — góc 1 (Kênh lịch sử ngắn 5 phút)");
    const response = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/topics/suggest`,
      payload: { hint: "Ai Cập", count: 3 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: ProfileTopic[]; rejectedDuplicates: number }>();
    expect(body.rejectedDuplicates).toBe(0);
    expect(body.items.find((item) => item.topic.includes("góc 1"))?.notes).toContain("đã xếp hàng");
  });

  it("approves topics in bulk", async () => {
    const profile = await createProfile();
    const a = await addTopic(profile.id, "Chủ đề A");
    const b = await addTopic(profile.id, "Chủ đề B");
    const response = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/topics/approve`,
      payload: { ids: [a.id, b.id], status: "APPROVED" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: ProfileTopic[] }>().items.filter((item) => item.status === "APPROVED")).toHaveLength(2);
  });
});

describe("automation ticker", () => {
  it("creates one AUTO project at the right lead-time slot", async () => {
    const profile = await enableAutomation((await createProfile()).id);
    await addTopic(profile.id, "La Mã cổ đại", "APPROVED");

    await withFixedNow("2026-11-04T07:00:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });

    const items = await listTopics(profile.id);
    const inProd = items.find((item) => item.status === "IN_PRODUCTION");
    expect(inProd?.projectId).toBeTruthy();
    expect(inProd?.scheduledFor).toBe("2026-11-04T12:00:00.000Z");

    const project = (await app.inject({ method: "GET", url: `/api/projects/${inProd!.projectId}` })).json<Project>();
    expect(project.mode).toBe("AUTO");
    expect(project.settings.autoRender).toBe(true);

    // One pipeline at a time: second approved topic stays queued
    await addTopic(profile.id, "Hy Lạp cổ đại", "APPROVED");
    await withFixedNow("2026-11-04T07:00:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });
    expect((await listTopics(profile.id)).filter((item) => item.status === "IN_PRODUCTION")).toHaveLength(1);
  });

  it("respects the daily cap", async () => {
    const profile = await enableAutomation((await createProfile()).id, { videosPerDay: 1 });
    await addTopic(profile.id, "Chủ đề 1", "APPROVED");
    await addTopic(profile.id, "Chủ đề 2", "APPROVED");

    await withFixedNow("2026-11-04T07:00:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });
    const first = (await listTopics(profile.id)).find((item) => item.status === "IN_PRODUCTION")!;
    updateTopicProductionSync(sqlite(), first.id, { status: "DONE" });

    await withFixedNow("2026-11-04T07:05:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });
    expect((await listTopics(profile.id)).filter((item) => item.status === "IN_PRODUCTION")).toHaveLength(0);
    expect((await listTopics(profile.id)).filter((item) => item.status === "APPROVED")).toHaveLength(1);
  });

  it("respects the paused kill switch", async () => {
    const profile = await enableAutomation((await createProfile()).id);
    await addTopic(profile.id, "Chủ đề pause", "APPROVED");
    await app.inject({ method: "PUT", url: "/api/settings/automation", payload: { paused: true } });

    await withFixedNow("2026-11-04T07:00:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });
    expect((await listTopics(profile.id)).every((item) => item.status === "APPROVED")).toBe(true);
  });

  it("reschedules a missed slot to the next free future slot", async () => {
    const profile = await enableAutomation((await createProfile()).id, {
      publishTimes: ["09:00", "19:00"],
      leadTimeHours: 6,
    });
    await addTopic(profile.id, "Missed morning", "APPROVED");

    // 17:00 ICT — morning 09:00 missed; evening 19:00 within lead → use 19:00
    await withFixedNow("2026-11-04T10:00:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });
    const inProd = (await listTopics(profile.id)).find((item) => item.status === "IN_PRODUCTION");
    expect(inProd?.scheduledFor).toBe("2026-11-04T12:00:00.000Z");
  });

  it("end-to-end: topic → project → stub render → scheduled publication", async () => {
    const profile = await enableAutomation((await createProfile()).id);
    const accountRes = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/accounts`,
      payload: {
        platform: "mock",
        displayName: "Mock Auto",
        publishSettings: { autoPublish: true },
      },
    });
    const account = accountRes.json<PlatformAccount>();
    const start = await app.inject({ method: "GET", url: `/api/oauth/mock/start?accountId=${account.id}` });
    const state = new URL(start.headers.location as string).searchParams.get("state");
    await app.inject({ method: "GET", url: `/api/oauth/mock/callback?code=x&state=${state}` });

    const topic = await addTopic(profile.id, "Chiến tranh Peloponnese", "APPROVED");

    await withFixedNow("2026-11-04T07:00:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });

    const inProd = (await listTopics(profile.id)).find((item) => item.id === topic.id)!;
    expect(inProd.status).toBe("IN_PRODUCTION");
    seedRender(inProd.projectId!);

    await withFixedNow("2026-11-04T07:01:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });

    const done = (await listTopics(profile.id)).find((item) => item.id === topic.id)!;
    expect({ status: done.status, error: done.error }).toEqual({ status: "DONE", error: null });

    const pubs = await app.inject({ method: "GET", url: `/api/projects/${inProd.projectId}/publications` });
    const publications = pubs.json<{ items: Publication[] }>().items;
    expect(publications.length).toBeGreaterThanOrEqual(1);
    expect(publications[0]!.scheduledFor).toBe("2026-11-04T12:00:00.000Z");
  });

  it("exposes automation status and profile schedule view", async () => {
    const profile = await enableAutomation((await createProfile()).id);
    await addTopic(profile.id, "Status topic", "APPROVED");
    const status = await app.inject({ method: "GET", url: "/api/automation/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ profiles: Array<{ profileId: string }> }>().profiles.some((row) => row.profileId === profile.id)).toBe(true);

    const view = await app.inject({ method: "GET", url: `/api/profiles/${profile.id}/automation` });
    expect(view.statusCode).toBe(200);
    expect(view.json<{ automation: { enabled: boolean }; slots: unknown[] }>().automation.enabled).toBe(true);
    expect(view.json<{ slots: unknown[] }>().slots.length).toBeGreaterThan(0);
  });

  it("auto-suggest: PENDING supply + 6h cooldown (only one LLM call across 10 ticks)", async () => {
    const profile = await enableAutomation((await createProfile()).id, {
      autoSuggest: true,
      autoApproveTopics: false,
      videosPerDay: 5,
      publishTimes: ["09:00", "12:00", "15:00", "18:00", "21:00"],
    });

    const base = Date.parse("2026-11-04T07:00:00.000Z");
    for (let i = 0; i < 10; i += 1) {
      await withFixedNow(new Date(base + i * 60_000).toISOString(), async () => {
        await app.vgAutomation.service.tick();
      });
    }

    const suggestLogs = listAutomationLogSync(sqlite(), { profileId: profile.id, limit: 50 })
      .filter((entry) => entry.data && (entry.data as { kind?: string }).kind === "autoSuggest");
    expect(suggestLogs).toHaveLength(1);
    const pending = (await listTopics(profile.id)).filter((item) => item.status === "PENDING" && item.source === "LLM");
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.length).toBeLessThanOrEqual(5);

    // Still needed (supply < free slots) but cooldown holds until 6h.
    await withFixedNow(new Date(base + 3 * 3600_000).toISOString(), async () => {
      await app.vgAutomation.service.tick();
    });
    expect(
      listAutomationLogSync(sqlite(), { profileId: profile.id, limit: 50 })
        .filter((entry) => entry.data && (entry.data as { kind?: string }).kind === "autoSuggest"),
    ).toHaveLength(1);

    await withFixedNow(new Date(base + 6 * 3600_000 + 60_000).toISOString(), async () => {
      await app.vgAutomation.service.tick();
    });
    expect(
      listAutomationLogSync(sqlite(), { profileId: profile.id, limit: 50 })
        .filter((entry) => entry.data && (entry.data as { kind?: string }).kind === "autoSuggest"),
    ).toHaveLength(2);
  });

  it("late finish: publication moves to the next free future slot, never the past", async () => {
    const profile = await enableAutomation((await createProfile()).id, {
      publishTimes: ["09:00", "19:00"],
      videosPerDay: 2,
    });
    const accountRes = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/accounts`,
      payload: {
        platform: "mock",
        displayName: "Mock Late",
        publishSettings: { autoPublish: true },
      },
    });
    const account = accountRes.json<PlatformAccount>();
    const start = await app.inject({ method: "GET", url: `/api/oauth/mock/start?accountId=${account.id}` });
    const state = new URL(start.headers.location as string).searchParams.get("state");
    await app.inject({ method: "GET", url: `/api/oauth/mock/callback?code=x&state=${state}` });

    const topic = await addTopic(profile.id, "Render muộn", "APPROVED");
    await withFixedNow("2026-11-04T07:00:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });
    const inProd = (await listTopics(profile.id)).find((item) => item.id === topic.id)!;
    expect(inProd.scheduledFor).toBe("2026-11-04T12:00:00.000Z"); // 19:00 ICT
    seedRender(inProd.projectId!);

    // Finish after the slot has passed (19:10 ICT).
    await withFixedNow("2026-11-04T12:10:00.000Z", async () => {
      await app.vgAutomation.service.tick();
    });

    const done = (await listTopics(profile.id)).find((item) => item.id === topic.id)!;
    expect(done.status).toBe("DONE");
    expect(done.scheduledFor).toBe("2026-11-05T02:00:00.000Z"); // next free: tomorrow 09:00 ICT

    const pubs = await app.inject({ method: "GET", url: `/api/projects/${inProd.projectId}/publications` });
    const publications = pubs.json<{ items: Publication[] }>().items;
    expect(publications[0]!.scheduledFor).toBe("2026-11-05T02:00:00.000Z");
    expect(Date.parse(publications[0]!.scheduledFor!)).toBeGreaterThan(Date.parse("2026-11-04T12:10:00.000Z"));

    const moved = listAutomationLogSync(sqlite(), { profileId: profile.id, limit: 50 })
      .filter((entry) => entry.level === "warn" && entry.message.startsWith("Dời lịch đăng"));
    expect(moved.length).toBeGreaterThanOrEqual(1);
    expect(moved[0]!.message).toContain("2026-11-04T12:00:00.000Z");
    expect(moved[0]!.message).toContain("2026-11-05T02:00:00.000Z");
  });

  it("logs «hết chủ đề APPROVED» at most once per profile per 6 hours", async () => {
    const profile = await enableAutomation((await createProfile()).id);
    // No APPROVED topics — every tick with a free slot would otherwise spam.
    const base = Date.parse("2026-11-04T07:00:00.000Z");
    for (let i = 0; i < 8; i += 1) {
      await withFixedNow(new Date(base + i * 60_000).toISOString(), async () => {
        await app.vgAutomation.service.tick();
      });
    }
    const warnings = listAutomationLogSync(sqlite(), { profileId: profile.id, limit: 50 })
      .filter((entry) => entry.message === "Có slot trống nhưng hết chủ đề APPROVED");
    expect(warnings).toHaveLength(1);
  });
});
