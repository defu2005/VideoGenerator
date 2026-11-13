import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComposePlanSchema,
  computeStats,
  DEFAULT_VARIANT_WINDOW,
  reviseStylePack,
  STYLE_PRESETS,
  stylePackFromChoices,
  stylePackTokens,
  TimelineSchema,
  type Shot,
  type Timeline,
} from "@vg/shared";
import { registerStyleRoutes } from "../src/api/style.js";
import { prepareGraphicStyle } from "../src/compose/render/graphicStyle.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { AppError } from "../src/lib/errors.js";
import { RenderService, type MediaTools } from "../src/services/renderService.js";
import { StyleService } from "../src/style/service.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const open: Array<{ close: () => void }> = [];
const now = "2026-11-12T03:00:00.000Z";

function memory() {
  const opened = openDatabase(":memory:");
  open.push({ close: () => opened.sqlite.close() });
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}

function profile(sqlite: ReturnType<typeof memory>, name: string, color?: string): string {
  const id = randomUUID();
  sqlite.prepare(
    "INSERT INTO profiles (id, name, default_brief, guidelines, color, created_at, updated_at) VALUES (?, ?, '{}', '{}', ?, ?, ?)",
  ).run(id, name, color ?? "#3B82F6", now, now);
  return id;
}

function projectRow(sqlite: ReturnType<typeof memory>, profileId: string): { projectId: string; renderId: string } {
  const projectId = randomUUID();
  const renderId = randomUUID();
  sqlite.prepare(
    "INSERT INTO projects (id, title, topic, mode, settings, status, stage, profile_id, created_at, updated_at) VALUES (?, 'Video', 'Topic', 'AUTO', '{}', 'DONE', 'RENDER', ?, ?, ?)",
  ).run(projectId, profileId, now, now);
  sqlite.prepare(
    "INSERT INTO renders (id, project_id, input_hash, status, output_path, duration_sec, size_bytes, width, height, report, created_at) VALUES (?, ?, 'h', 'DONE', 'out.mp4', 4, 1, 1920, 1080, '{}', ?)",
  ).run(renderId, projectId, now);
  return { projectId, renderId };
}

const listShot: Shot = {
  id: "s0",
  kind: "list_full",
  startSec: 0,
  endSec: 4,
  reason: "test",
  source: { kind: "list_full", items: ["Một", "Hai", "Ba"] },
};

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

describe("style packs", () => {
  it("stores a new version only when the look changes", () => {
    const sqlite = memory();
    const service = new StyleService(sqlite, () => new Date(now));
    const pack = stylePackFromChoices({ id: "kenh-1", name: "Kênh 1", presetId: "newsroom" });
    expect(service.savePack(pack).version).toBe(1);
    expect(service.savePack({ ...pack, name: "Tên khác" }).version).toBe(1);
    expect(service.listPacks()).toHaveLength(1);
    expect(service.getPack(pack.id, 1)?.name).toBe("Kênh 1");

    const changed = reviseStylePack(pack, { layout: { density: 0.7 } });
    expect(changed.version).toBe(2);
    expect(service.savePack(changed).version).toBe(2);
    expect(service.getPack(pack.id)?.version).toBe(2);
    expect(service.getPack(pack.id, 1)?.tokens).toEqual(pack.tokens);
    expect(service.savePack(changed).version).toBe(2);
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM style_packs").get() as { n: number };
    expect(count.n).toBe(2);
  });

  it("gives two new profiles different presets, and a chosen colour a brand pack", () => {
    const sqlite = memory();
    const service = new StyleService(sqlite, () => new Date(now));
    const first = service.packForProfile(profile(sqlite, "Kênh A"));
    const second = service.packForProfile(profile(sqlite, "Kênh B"));
    expect(first?.origin.kind).toBe("preset");
    expect(second?.origin.kind).toBe("preset");
    expect(first?.origin.presetId).not.toBe(second?.origin.presetId);
    expect(STYLE_PRESETS.map((preset) => preset.id)).toEqual(expect.arrayContaining([
      first?.origin.presetId,
      second?.origin.presetId,
    ]));
    expect(service.packForProfile(randomUUID())).toBeNull();
    const again = service.packForProfile(
      (sqlite.prepare("SELECT id FROM profiles WHERE name = 'Kênh A'").get() as { id: string }).id,
    );
    expect(again).toEqual(first);

    const branded = service.packForProfile(profile(sqlite, "Kênh màu", "#112233"));
    expect(branded?.origin.kind).toBe("brand");
    expect(stylePackTokens(branded!).palette.brand).toBe("#112233");
  });

  it("feeds stored history to the picker so the next video avoids the last combination", () => {
    const sqlite = memory();
    const service = new StyleService(sqlite, () => new Date(now));
    const profileId = profile(sqlite, "Kênh xoay");
    const pack = service.packForProfile(profileId)!;
    const { projectId, renderId } = projectRow(sqlite, profileId);
    const frame = { projectId, profileId, width: 1920, height: 1080, shots: [listShot], pack };
    const natural = prepareGraphicStyle({ ...frame, history: { videos: [] } });
    service.recordLook({
      projectId,
      renderId,
      profileId,
      style: natural.resolved!,
      picks: natural.picks!,
      shotSec: { [listShot.id]: 4 },
      kindShare: { list_full: 1 },
      frameHashes: [],
    });
    const history = service.lookHistory(profileId, DEFAULT_VARIANT_WINDOW);
    expect(history.videos[0]?.combos.map((combo) => combo.key)).toContain(natural.picks![0]!.key);
    const second = prepareGraphicStyle({ ...frame, styles: service });
    expect(second.picks![0]!.key).not.toBe(natural.picks![0]!.key);
    expect(second.picks![0]!.reused).toBe(false);
  });
});

describe("style routes", () => {
  it("lists presets, the linked pack and the newest looks", async () => {
    const sqlite = memory();
    const service = new StyleService(sqlite, () => new Date(now));
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    });
    registerStyleRoutes(app, sqlite);
    const profileId = profile(sqlite, "Kênh API");
    const missing = randomUUID();

    const presets = await app.inject({ method: "GET", url: "/api/style/presets" });
    expect(presets.statusCode).toBe(200);
    expect(presets.json().presets.map((item: { id: string }) => item.id)).toEqual(STYLE_PRESETS.map((item) => item.id));

    const empty = await app.inject({ method: "GET", url: `/api/profiles/${profileId}/style-pack` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ pack: null, tokens: null });
    expect((await app.inject({ method: "GET", url: `/api/profiles/${missing}/style-pack` })).statusCode).toBe(404);

    const pack = service.packForProfile(profileId)!;
    const linked = await app.inject({ method: "GET", url: `/api/profiles/${profileId}/style-pack` });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().pack.id).toBe(pack.id);
    expect(linked.json().pack.version).toBe(1);
    expect(linked.json().tokens.palette.brand).toBe(stylePackTokens(pack).palette.brand);

    const { projectId, renderId } = projectRow(sqlite, profileId);
    const older = projectRow(sqlite, profileId);
    const frame = { projectId, profileId, width: 1920, height: 1080, shots: [listShot], pack };
    const look = prepareGraphicStyle({ ...frame, history: { videos: [] } });
    service.recordLook({
      projectId: older.projectId,
      renderId: older.renderId,
      profileId,
      createdAt: "2026-11-11T00:00:00.000Z",
      style: look.resolved!,
      picks: look.picks!,
      shotSec: { [listShot.id]: 4 },
      kindShare: { list_full: 1 },
      frameHashes: [],
    });
    service.recordLook({
      projectId,
      renderId,
      profileId,
      createdAt: "2026-11-12T00:00:00.000Z",
      style: look.resolved!,
      picks: look.picks!,
      shotSec: { [listShot.id]: 4 },
      kindShare: { list_full: 1 },
      frameHashes: [],
    });
    const looks = await app.inject({ method: "GET", url: `/api/profiles/${profileId}/looks?limit=1` });
    expect(looks.statusCode).toBe(200);
    expect(looks.json().looks).toHaveLength(1);
    expect(looks.json().looks[0].videoId).toBe(renderId);
    expect((await app.inject({ method: "GET", url: `/api/profiles/${missing}/looks` })).statusCode).toBe(404);
    await app.close();
  });
});

const harnesses: Array<ReturnType<typeof createPipelineHarness>> = [];
const SCENE = "11111111-1111-4111-8111-111111111111";
const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } };

function renderSetup() {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  const dir = projectDir(harness.config.DATA_DIR, harness.projectId);
  mkdirSync(join(dir, "visuals"), { recursive: true });
  const timeline: Timeline = TimelineSchema.parse({
    formatVersion: 1,
    target: { width: 160, height: 90, fps: 30 },
    totalDurationSec: 1.5,
    scenes: [{
      sceneId: SCENE, order: 0, label: "Một", startSec: 0, endSec: 1.5, durationSec: 1.5, durationFrames: 45,
      voice: null,
      visuals: [{ kind: "PLACEHOLDER", candidateId: null, path: null, startSec: 0, endSec: 1.5, motion, licenseKind: null }],
      fadeInSec: 0.2, fadeOutSec: 0.2,
    }],
    music: null,
    subtitles: null,
    warnings: [],
    licenseSummary: {},
  });
  const timelines = { get: () => ({ timeline, inputHash: "timeline-hash-1", updatedAt: "now" }) };
  const tools: MediaTools = {
    ffmpeg: vi.fn(async (args, options) => {
      const out = args[args.length - 1];
      if (out && out !== "-") writeFileSync(options.cwd && !out.includes(":") && !out.startsWith("/") ? join(options.cwd, out) : out, "x");
      return { stdout: "", stderr: "" };
    }),
    probe: vi.fn(async () => ({ durationSec: 1.5, width: 160, height: 90, hasVideo: true, hasAudio: true })),
  };
  return { harness, timelines, tools, project: () => harness.repository.getProject(harness.projectId)! };
}

describe("style looks on render", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
  });

  it("finishes the render when recording the look throws", async () => {
    const { harness, timelines, tools, project } = renderSetup();
    harness.sqlite.exec("DROP TABLE video_looks");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
      const { render, reused } = await service.render(project(), new AbortController().signal);
      expect(reused).toBe(false);
      expect(render.status).toBe("DONE");
      const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("[style]");
      expect(logged).toContain(harness.projectId);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not record a second look when the render is reused", async () => {
    const { harness, timelines, tools, project } = renderSetup();
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
    const first = await service.render(project(), new AbortController().signal);
    expect(first.reused).toBe(false);
    const count = () => (harness.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM video_looks WHERE project_id = ?",
    ).get(harness.projectId) as { n: number }).n;
    expect(count()).toBe(1);
    const again = await service.render(project(), new AbortController().signal);
    expect(again.reused).toBe(true);
    expect(count()).toBe(1);
  });

  it("stores the profile pack on the render report and records one look", async () => {
    const { harness, timelines, tools } = renderSetup();
    const profileId = profile(harness.sqlite, `Kênh ${randomUUID().slice(0, 8)}`);
    harness.sqlite.prepare("UPDATE projects SET profile_id = ? WHERE id = ?").run(profileId, harness.projectId);
    const stored = harness.repository.getProject(harness.projectId)!;
    const project = {
      ...stored,
      profileId,
      settings: { ...stored.settings, edit: { ...stored.settings.edit, engine: "compose" as const } },
    };
    const plan = ComposePlanSchema.parse({
      version: 1,
      engine: "compose",
      preset: "story",
      aspect: "16:9",
      scenes: [],
      stats: computeStats({ scenes: [] }, [], []),
    });
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools, () => new Date(), undefined, undefined, {
      plan: async () => ({ plan, warnings: [] }),
    });
    const { render } = await service.render(project, new AbortController().signal);
    expect(render.report.compose?.style).toMatchObject({ packId: profileId, packVersion: 1 });
    const rows = harness.sqlite.prepare("SELECT pack_id, pack_version FROM video_looks WHERE render_id = ?").all(render.id) as Array<{ pack_id: string; pack_version: number }>;
    expect(rows).toEqual([{ pack_id: profileId, pack_version: 1 }]);
    const again = await service.render(project, new AbortController().signal);
    expect(again.reused).toBe(true);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS n FROM video_looks").get()).toEqual({ n: 1 });
  });
});
