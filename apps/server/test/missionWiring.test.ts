import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PlatformAccount, ProfileDetail, Project, Publication } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { createMission } from "../src/missions/missions.js";
import { listAgentEvents } from "../src/events/agentBus.js";
import { markMissionScheduled, recordPublicationPublished, resumeMissionsForProject } from "../src/missions/checkpoints.js";
import { TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129c production wiring: the publish path, the gate approval route, and the scheduled gate. Fakes only, no network.
const apps: Array<{ close(): Promise<unknown> }> = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-mission-wiring-")); roots.push(root);
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor } as never });
  apps.push(app);
  const sqlite = app.vgAssistant.service.toolContext().sqlite;
  return { app, sqlite, root, config };
}

async function createProfile(app: ReturnType<typeof buildApp>): Promise<ProfileDetail> {
  const response = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: `Wiring ${randomUUID().slice(0, 8)}` } });
  expect(response.statusCode).toBe(201);
  return response.json<ProfileDetail>();
}

async function addConnectedMockAccount(app: ReturnType<typeof buildApp>, profileId: string): Promise<PlatformAccount> {
  const created = await app.inject({ method: "POST", url: `/api/profiles/${profileId}/accounts`, payload: { platform: "mock", displayName: "Mock Channel", handle: "@mock" } });
  expect(created.statusCode).toBe(201);
  const account = created.json<PlatformAccount>();
  const start = await app.inject({ method: "GET", url: `/api/oauth/mock/start?accountId=${account.id}` });
  const state = new URL(start.headers.location as string).searchParams.get("state");
  const callback = await app.inject({ method: "GET", url: `/api/oauth/mock/callback?code=test-code&state=${state}` });
  expect(callback.statusCode).toBe(302);
  return account;
}

async function createProject(app: ReturnType<typeof buildApp>, profileId: string): Promise<Project> {
  const response = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Wiring topic", profileId, title: "Wiring" } });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function seedRender(h: ReturnType<typeof setup>, projectId: string): string {
  const renderId = randomUUID();
  const now = new Date().toISOString();
  const absolute = join(h.config.DATA_DIR, "projects", projectId, "renders", `${renderId}.mp4`);
  mkdirSync(join(h.config.DATA_DIR, "projects", projectId, "renders"), { recursive: true });
  writeFileSync(absolute, Buffer.from("fake-video"));
  h.sqlite.prepare(
    `INSERT INTO renders (id, project_id, input_hash, status, output_path, credits_path, srt_path, duration_sec, size_bytes, width, height, report, created_at, version, note, pinned, deleted_at, review_thread_id, metadata_snapshot, aspect_ratio, variant_of)
     VALUES (?, ?, 'hash', 'DONE', ?, NULL, NULL, 30, 1000, 1920, 1080, ?, ?, 1, NULL, 0, NULL, NULL, NULL, NULL, NULL)`,
  ).run(renderId, projectId, absolute, JSON.stringify({ ok: true, issues: [] }), now);
  h.sqlite.prepare(
    `INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at) VALUES (?, 'hash', ?, NULL, 'CODE', ?, ?)`,
  ).run(projectId, JSON.stringify({ titles: ["Tiêu đề"], description: "Mô tả", tags: ["test"], hashtags: ["#test"], thumbnailText: ["Test"] }), now, now);
  return renderId;
}

function makeMission(h: ReturnType<typeof setup>, projectIds: string[], state: string) {
  const mission = createMission(h.sqlite, TEST_WORKSPACE_ID, { command: "làm video", channelProfileId: null, projectIds } as never, { createdBy: "user", owner: null });
  h.sqlite.prepare("UPDATE missions SET state = ? WHERE id = ?").run(state, mission.id);
  return mission.id;
}

const stateOf = (h: ReturnType<typeof setup>, id: string) =>
  (h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(id) as { state: string }).state;

describe("TASK-129c production wiring", () => {
  it("publish path: a mission moves to scheduled only after every project has a live publication", async () => {
    const h = setup();
    const profile = await createProfile(h.app);
    const account = await addConnectedMockAccount(h.app, profile.id);
    const p1 = await createProject(h.app, profile.id);
    const p2 = await createProject(h.app, profile.id);
    seedRender(h, p1.id);
    seedRender(h, p2.id);
    const id = makeMission(h, [p1.id, p2.id], "producing");
    const service = h.app.vgPublish.service;

    await service.createForProject(p1.id, { accountIds: [account.id] } as never, { missionId: id });
    expect(stateOf(h, id)).toBe("producing");
    await service.createForProject(p2.id, { accountIds: [account.id] } as never, { missionId: id });
    expect(stateOf(h, id)).toBe("scheduled");
  });

  it("publish path: a reused publication without a mission joins the mission, and a project outside the mission is rejected", async () => {
    const h = setup();
    const profile = await createProfile(h.app);
    const account = await addConnectedMockAccount(h.app, profile.id);
    const p1 = await createProject(h.app, profile.id);
    const outsider = await createProject(h.app, profile.id);
    seedRender(h, p1.id);
    seedRender(h, outsider.id);
    const id = makeMission(h, [p1.id], "producing");
    const service = h.app.vgPublish.service;

    // An ordinary publication made before the mission existed: it has no mission_id.
    const scheduledBefore = listAgentEvents({ types: ["publish_scheduled"] }).length;
    const [existing] = await service.createForProject(p1.id, { accountIds: [account.id] } as never) as Publication[];
    expect(h.sqlite.prepare("SELECT mission_id AS m FROM publications WHERE id = ?").get(existing!.id)).toEqual({ m: null });
    // TASK-129a §1: one publish_scheduled per new publication row.
    expect(listAgentEvents({ types: ["publish_scheduled"] }).length - scheduledBefore).toBe(1);

    const [reused] = await service.createForProject(p1.id, { accountIds: [account.id] } as never, { missionId: id }) as Publication[];
    expect(listAgentEvents({ types: ["publish_scheduled"] }).length - scheduledBefore).toBe(1);
    expect(reused!.id).toBe(existing!.id);
    expect(h.sqlite.prepare("SELECT mission_id AS m FROM publications WHERE id = ?").get(existing!.id)).toEqual({ m: id });
    expect(stateOf(h, id)).toBe("scheduled");

    await expect(service.createForProject(outsider.id, { accountIds: [account.id] } as never, { missionId: id }))
      .rejects.toMatchObject({ statusCode: 422, code: "MISSION_PROJECT_NOT_IN_MISSION" });
  });

  it("a video that went out while the mission was still producing starts the clock at its publish time when the mission is scheduled", async () => {
    const h = setup();
    const profile = await createProfile(h.app);
    const account = await addConnectedMockAccount(h.app, profile.id);
    const p1 = await createProject(h.app, profile.id);
    const p2 = await createProject(h.app, profile.id);
    seedRender(h, p1.id);
    seedRender(h, p2.id);
    const id = makeMission(h, [p1.id, p2.id], "producing");
    const service = h.app.vgPublish.service;

    const [first] = await service.createForProject(p1.id, { accountIds: [account.id] } as never, { missionId: id }) as Publication[];
    const publishedAt = "2026-11-18T08:00:00.000Z";
    // The worker posts p1's video before p2 is queued: the mission is still producing.
    h.sqlite.prepare("UPDATE publications SET status = 'PUBLISHED', published_at = ? WHERE id = ?").run(publishedAt, first!.id);
    recordPublicationPublished(h.sqlite, first!.id);
    expect(stateOf(h, id)).toBe("producing");

    await service.createForProject(p2.id, { accountIds: [account.id] } as never, { missionId: id });
    expect(stateOf(h, id)).toBe("published");
    expect(h.sqlite.prepare("SELECT at FROM mission_checkpoints WHERE mission_id = ? AND kind = 'published'").get(id))
      .toEqual({ at: publishedAt });
  });

  it("gate approval route: the user's approve resumes a held mission only when no other project still waits", async () => {
    const h = setup();
    const profile = await createProfile(h.app);
    const p1 = await createProject(h.app, profile.id);
    const p2 = await createProject(h.app, profile.id);
    const id = makeMission(h, [p1.id, p2.id], "waiting_user");
    const now = new Date().toISOString();
    const setStage = (projectId: string, stage: string, state: string) =>
      h.sqlite.prepare("INSERT OR REPLACE INTO project_stages (project_id, stage, state, progress, updated_at) VALUES (?, ?, ?, 0, ?)").run(projectId, stage, state, now);
    setStage(p1.id, "VISUAL_REVIEW", "WAITING_USER");
    setStage(p2.id, "VISUAL_REVIEW", "WAITING_USER");

    const first = await h.app.inject({ method: "POST", url: `/api/projects/${p1.id}/pipeline/gates/VISUAL_REVIEW/approve` });
    expect(first.statusCode, first.body).toBe(200);
    expect(stateOf(h, id)).toBe("waiting_user");

    const second = await h.app.inject({ method: "POST", url: `/api/projects/${p2.id}/pipeline/gates/VISUAL_REVIEW/approve` });
    expect(second.statusCode).toBe(200);
    expect(stateOf(h, id)).toBe("producing");
  });

  it("an agent API key may approve a gate but does not resume a held mission", async () => {
    const h = setup();
    const profile = await createProfile(h.app);
    const p1 = await createProject(h.app, profile.id);
    const id = makeMission(h, [p1.id], "waiting_user");
    h.sqlite.prepare("INSERT OR REPLACE INTO project_stages (project_id, stage, state, progress, updated_at) VALUES (?, 'VISUAL_REVIEW', 'WAITING_USER', 0, ?)")
      .run(p1.id, new Date().toISOString());
    const agent = buildApp({ config: h.config, testActor: { ...testActor, kind: "apikey", keyId: "agent-a", role: "owner" } as never });
    apps.push(agent);
    const res = await agent.inject({ method: "POST", url: `/api/projects/${p1.id}/pipeline/gates/VISUAL_REVIEW/approve` });
    expect(res.statusCode, res.body).toBe(200);
    expect(stateOf(h, id)).toBe("waiting_user");
  });

  it("resumeMissionsForProject ignores missions that are not waiting", async () => {
    const h = setup();
    const profile = await createProfile(h.app);
    const p1 = await createProject(h.app, profile.id);
    const id = makeMission(h, [p1.id], "producing");
    expect(resumeMissionsForProject(h.sqlite, p1.id)).toEqual([]);
    expect(stateOf(h, id)).toBe("producing");
  });
});
