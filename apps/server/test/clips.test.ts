import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SPEECH_HINT } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-clips-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "clips.db"),
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
  mkdirSync(dataDir, { recursive: true });
  config = { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") };
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function sqlite() {
  return (app.vgClips as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

const srt = [
  "1",
  "00:00:00,000 --> 00:00:25,000",
  "Mở đầu rõ ràng về kính thiên văn.",
  "",
  "2",
  "00:00:25,000 --> 00:00:55,000",
  "Hubble chụp được thiên hà xa xôi năm đó.",
  "",
  "3",
  "00:00:55,000 --> 00:01:25,000",
  "Tinh vân Orion phát sáng giữa bầu trời.",
  "",
].join("\n");

describe("external clip import", () => {
  it("refuses a video without the ownership confirmation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/clips/import",
      payload: { videoPath: "C:/video/long.mp4", ownershipConfirmed: false, transcript: srt },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: "OWNERSHIP_REQUIRED",
      message: expect.stringMatching(/sở hữu/),
    });
  });

  it("refuses a video that has neither a transcript nor a speech CLI", async () => {
    const video = join(config.DATA_DIR, "long.mp4");
    writeFileSync(video, "not-a-real-video");
    const response = await app.inject({
      method: "POST",
      url: "/api/clips/import",
      payload: { videoPath: video, ownershipConfirmed: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string; message: string } }>().error).toEqual({
      code: "SPEECH_REQUIRED",
      message: SPEECH_HINT,
    });
  });

  it("imports an owned video when an SRT transcript is provided", async () => {
    const video = join(config.DATA_DIR, "owned.mp4");
    writeFileSync(video, "fake");
    const response = await app.inject({
      method: "POST",
      url: "/api/clips/import",
      payload: { videoPath: video, ownershipConfirmed: true, transcript: srt, title: "Video nhập" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ projectId: string; view: { proposals: Array<{ start: number; end: number }> } }>();
    expect(body.view.proposals.length).toBeGreaterThan(0);
    expect(body.view.proposals[0]!.end - body.view.proposals[0]!.start).toBeGreaterThanOrEqual(20);
  });
});

describe("clip projects and schedule", () => {
  it("creates child projects on vertical accounts after the parent publish time", async () => {
    const profile = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: { name: `Clips ${randomUUID().slice(0, 6)}`, direction: "Khoa học", language: "vi" },
    });
    expect(profile.statusCode).toBe(201);
    const profileId = profile.json<{ id: string }>().id;
    await app.inject({
      method: "PATCH",
      url: `/api/profiles/${profileId}`,
      payload: { automation: { publishTimes: ["19:00"], videosPerDay: 1, timezone: "Asia/Ho_Chi_Minh" } },
    });
    const vertical = await app.inject({
      method: "POST",
      url: `/api/profiles/${profileId}/accounts`,
      payload: { platform: "tiktok", displayName: "TikTok", format: "vertical" },
    });
    const landscape = await app.inject({
      method: "POST",
      url: `/api/profiles/${profileId}/accounts`,
      payload: { platform: "youtube", displayName: "YouTube ngang", format: "landscape" },
    });
    expect(vertical.statusCode).toBe(201);
    expect(landscape.statusCode).toBe(201);
    const tiktokId = vertical.json<{ id: string }>().id;

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Kính thiên văn", title: "Hubble", profileId, settings: { aspectRatio: "16:9", language: "vi" } },
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json<{ id: string }>().id;
    const db = sqlite();
    const now = new Date().toISOString();
    const renderId = randomUUID();
    const video = join(config.DATA_DIR, "parent.mp4");
    writeFileSync(video, "parent-video");
    db.prepare(
      `INSERT INTO renders (id, project_id, input_hash, status, output_path, duration_sec, size_bytes, width, height, report, created_at, aspect_ratio)
       VALUES (?, ?, ?, 'DONE', ?, 125, 12, 1920, 1080, ?, ?, '16:9')`,
    ).run(renderId, projectId, "hash", video, JSON.stringify({
      ok: true, expectedDurationSec: 125, durationSec: 125, width: 1920, height: 1080, hasAudio: true,
      issues: [], thumbnails: [], clipsReused: 0, clipsRendered: 1, elapsedSec: 1,
    }), now);
    const cues = [
      { startSec: 0, endSec: 25, text: "Mở đầu rõ ràng về kính thiên văn." },
      { startSec: 25, endSec: 55, text: "Hubble chụp được thiên hà xa xôi năm đó." },
      { startSec: 55, endSec: 85, text: "Tinh vân Orion phát sáng giữa bầu trời." },
    ];
    db.prepare(
      `INSERT INTO subtitle_tracks (id, project_id, cues, srt_path, ass_path, input_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'srt', 'ass', 'h', ?, ?)`,
    ).run(randomUUID(), projectId, JSON.stringify(cues), now, now);
    const parentPublish = "2026-12-01T12:00:00.000Z";
    db.prepare(
      `INSERT INTO publications (
        id, project_id, render_id, account_id, status, visibility_requested, visibility_used,
        scheduled_for, attempts, progress, warnings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'SCHEDULED', 'public', 'public', ?, 0, 0, '[]', ?, ?)`,
    ).run(randomUUID(), projectId, renderId, tiktokId, parentPublish, now, now);

    const proposed = await app.inject({ method: "POST", url: `/api/projects/${projectId}/clips/propose`, payload: { count: 2 } });
    expect(proposed.statusCode).toBe(200);
    const proposals = proposed.json<{ proposals: Array<{ id: string }> }>().proposals;
    expect(proposals.length).toBeGreaterThan(0);
    const ids = proposals.slice(0, 2).map((item) => item.id);
    app.vgClips.setTools({
      ffmpeg: async (args) => {
        const output = args[args.length - 1]!;
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, "clip-bytes");
        return { stdout: "", stderr: "" };
      },
    });
    const exported = await app.inject({ method: "POST", url: `/api/projects/${projectId}/clips/export`, payload: { ids } });
    expect(exported.statusCode).toBe(200);
    const jobs = exported.json<{ jobs: Array<{ id: string }> }>().jobs;
    expect(jobs.length).toBe(ids.length);
    for (const job of jobs) {
      const row = db.prepare("SELECT project_id, scope FROM jobs WHERE id = ?").get(job.id) as { project_id: string; scope: string };
      await app.vgClips.runClip({
        projectId: row.project_id,
        scope: row.scope,
        signal: AbortSignal.timeout(5_000),
        reportProgress: () => undefined,
      });
    }
    const children = db.prepare("SELECT id, kind, parent_project_id, status, stage FROM projects WHERE parent_project_id = ?").all(projectId) as Array<{ id: string; kind: string; status: string; stage: string }>;
    expect(children.length).toBe(ids.length);
    expect(children.every((child) => child.kind === "clip" && child.status === "COMPLETED" && child.stage === "DONE")).toBe(true);
    const pubs = db.prepare(
      `SELECT p.scheduled_for, a.platform, a.format FROM publications p
       JOIN platform_accounts a ON a.id = p.account_id
       WHERE p.project_id != ?`,
    ).all(projectId) as Array<{ scheduled_for: string; platform: string; format: string }>;
    const clipPubs = pubs.filter((row) => row.scheduled_for !== parentPublish);
    expect(clipPubs.length).toBe(ids.length);
    expect(clipPubs.every((row) => row.platform === "tiktok" && row.format === "vertical")).toBe(true);
    expect(clipPubs.every((row) => Date.parse(row.scheduled_for) > Date.parse(parentPublish))).toBe(true);
  });
});
