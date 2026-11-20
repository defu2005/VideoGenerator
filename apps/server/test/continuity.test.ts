import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyContinuityPlan, continuityQueries, rgbToLab, type Job, type VisualCandidate } from "@vg/shared";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { SceneService } from "../src/services/sceneService.js";
import { VisualService } from "../src/services/visualService.js";
import { StageInputVersions } from "../src/pipeline/inputVersion.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { buildContinuityPlan } from "../src/continuity/builder.js";
import { readContinuity, writeContinuity } from "../src/continuity/store.js";
import { checkContinuity } from "../src/continuity/check.js";
import { projectDir } from "../src/storage/paths.js";
import { continuityToolDefs } from "../src/continuity/toolDefs.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

const active: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { vi.restoreAllMocks(); active.splice(0).forEach((h) => h.close()); });
function setup() {
  const h = createPipelineHarness({ config: { LLM_ENABLE_MOCK: true, LLM_DEFAULT_PROVIDER: "mock", LLM_CACHE_ENABLED: false } });
  active.push(h);
  const ids = [randomUUID(), randomUUID()];
  const now = h.clock().toISOString();
  const insert = h.sqlite.prepare(`INSERT INTO scenes(id,project_id,"order",kind,section_id,label,narration,visual_notes,visual_queries,music_mood,energy,est_duration_sec,duration_override_sec,start_sec,transition_note,origin,edited,input_hash,created_at,updated_at)
    VALUES (?,?,?,'section',NULL,?,'First sentence. Second sentence.','river',?,'','medium',5,NULL,?,'','AGENT',0,'fixture',?,?)`);
  ids.forEach((id, order) => insert.run(id, h.projectId, order, `Scene ${order + 1}`, JSON.stringify({ primary: "river landscape", alternatives: [] }), order * 5, now, now));
  const service = new SceneService(h.sqlite, h.repository);
  const registry = new LlmProviderRegistry(h.config);
  const context: StageContext = { project: h.repository.getProject(h.projectId)!, job: {} as Job, signal: new AbortController().signal,
    reportProgress: vi.fn(), recordUsage: vi.fn(), logger: Fastify({ logger: false }).log };
  const plan = emptyContinuityPlan();
  plan.palette.dominantHues = ["#df9c51"];
  plan.characters = [{ id: "explorer", description: "Explorer in a blue jacket", appearsInScenes: ids, referenceQuery: "explorer blue jacket" }];
  const save = () => writeContinuity(h.sqlite, h.projectId, { version: 1, plan, sourceHash: "fixture", weight: 0.05 });
  return { h, ids, plan, service, registry, context, save };
}

describe("continuity plan lifecycle", () => {
  it("uses the actual routed structured path and stores a validated plan", async () => {
    const f = setup();
    const generate = vi.spyOn(f.registry.get("mock")!, "generate").mockImplementation(async (request) => ({ text: JSON.stringify(f.plan), usage: { inputTokens: 50, outputTokens: 20 }, model: request.model, provider: "mock", finishReason: "stop" }));
    const result = await buildContinuityPlan(f.h.projectId, f.h.sqlite, f.registry, f.h.config, f.context);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].schemaName).toBe("ContinuityPlan");
    expect(result.note).toBeUndefined();
    expect(readContinuity(f.h.sqlite, f.h.projectId)?.plan).toEqual(f.plan);
    expect(f.context.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ llmCalls: 1, features: { continuityPlan: 1 } }));
  });

  it("retries invalid JSON once, then stores an empty plan without blocking", async () => {
    const f = setup();
    const generate = vi.spyOn(f.registry.get("mock")!, "generate").mockImplementation(async (request) => ({ text: "invalid", usage: { inputTokens: 10, outputTokens: 5 }, model: request.model, provider: "mock", finishReason: "stop" }));
    const result = await buildContinuityPlan(f.h.projectId, f.h.sqlite, f.registry, f.h.config, f.context);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.plan).toEqual(emptyContinuityPlan());
    expect(result.note).toContain("kế hoạch rỗng");
    expect(f.context.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ llmCalls: 2 }));
  });

  it("invalidates VISUAL_SEARCH inputVersion and rejects foreign scene IDs", () => {
    const f = setup();
    const versions = new StageInputVersions(f.h.sqlite, f.h.config.DATA_DIR);
    const before = versions.inputVersion(f.h.projectId, "VISUAL_SEARCH");
    f.service.patchContinuity(f.h.projectId, f.plan);
    expect(versions.inputVersion(f.h.projectId, "VISUAL_SEARCH")).not.toBe(before);
    expect(() => f.service.patchContinuity(f.h.projectId, { ...f.plan, characters: [{ ...f.plan.characters[0], appearsInScenes: [randomUUID()] }] })).toThrow("không thuộc dự án");
  });

  it("preserves the plan across edit/reorder/split/merge/deleting its storage row", () => {
    const f = setup(); f.save();
    f.service.patch(f.h.projectId, f.ids[0], { visualDescription: "River in warm light" });
    f.service.reorder(f.h.projectId, [...f.ids].reverse());
    expect(f.service.get(f.h.projectId).continuity?.plan).toEqual(f.plan);
    const split = f.service.split(f.h.projectId, f.ids[0], 0);
    const born = split.scenes.find((scene) => !f.ids.includes(scene.id))!;
    expect(split.continuity?.plan.characters[0].appearsInScenes).toContain(born.id);
    const merged = f.service.merge(f.h.projectId, [f.ids[0], born.id]);
    expect(merged.continuity?.plan.characters[0].appearsInScenes).not.toContain(born.id);
    const deleted = f.service.delete(f.h.projectId, f.ids[1]);
    expect(deleted.continuity?.plan.characters[0].appearsInScenes).toEqual([f.ids[0]]);
  });

  it("keeps the original query first and scopes additions to listed scenes", () => {
    const f = setup();
    const queries = continuityQueries(f.plan, f.ids[0], ["original", "alternative"]);
    expect(queries.slice(0, 2)).toEqual(["original", "alternative"]);
    expect(queries[2]).toContain("explorer blue jacket");
    expect(continuityQueries(f.plan, randomUUID(), ["original"])).toEqual(["original"]);
  });
});

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("hyperframes/package.json"))("sharp");
async function candidate(f: ReturnType<typeof setup>, sceneId: string, color: string, relevance = 0.8, lowRelevance = false): Promise<VisualCandidate> {
  const id = randomUUID();
  const path = join(f.h.config.DATA_DIR, "projects", f.h.projectId, "visuals", `${id}.png`);
  mkdirSync(join(path, ".."), { recursive: true });
  const bytes: Buffer = await sharp({ create: { width: 640, height: 360, channels: 3, background: color } }).png().toBuffer();
  await sharp(bytes).toFile(path);
  const row: Record<string, unknown> = { id, project_id: f.h.projectId, scene_id: sceneId, origin: "SEARCH", provider: "wikimedia", provider_item_id: id,
    query: "river landscape", title: "River landscape", description: "river landscape", tags: "[]", preview_url: `https://fixture.test/${id}.png`, image_url: `https://fixture.test/${id}.png`,
    source_url: "https://fixture.test", source_site: "Fixture", width: 640, height: 360, aspect_ratio: 640 / 360, file_type: "png", watermark: "NONE", relevance_score: relevance,
    score_breakdown: JSON.stringify({ keyword: relevance, lowRelevance }), license: JSON.stringify({ kind: "CC0", name: "CC0", url: null, author: "Fixture", authorUrl: null, attributionRequired: false, attributionText: "", evidence: "api" }),
    rank: 0, local_path: `visuals/${id}.png`, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, actual_width: 640, actual_height: 360,
    created_at: f.h.clock().toISOString(), search_hash: "fixture" };
  f.h.sqlite.prepare(`INSERT INTO visual_candidates(${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  return new VisualService(f.h.sqlite, f.h.repository, f.h.config).getSceneVisuals(f.h.projectId, sceneId).candidates.find((item) => item.id === id)!;
}

describe("continuity selection and facts", () => {
  it("selects the palette match among equals without promoting a failed relevance gate", async () => {
    const f = setup(); f.save();
    await candidate(f, f.ids[0], "#2244bb");
    const warm = await candidate(f, f.ids[0], "#df9c51");
    await candidate(f, f.ids[0], "#df9c51", 0.99, true);
    const visuals = new VisualService(f.h.sqlite, f.h.repository, f.h.config);
    const result = await visuals.repairPickNextCandidate(f.h.projectId, f.ids[0]);
    expect(result.candidateId).toBe(warm.id);
    expect(visuals.getSceneVisuals(f.h.projectId, f.ids[0]).selection?.candidateId).toBe(warm.id);
  });

  it("does not change a manual selection", async () => {
    const f = setup(); f.save();
    const cool = await candidate(f, f.ids[0], "#2244bb");
    await candidate(f, f.ids[0], "#df9c51");
    const at = f.h.clock().toISOString();
    f.h.sqlite.prepare("INSERT INTO visual_selections(id,project_id,scene_id,candidate_id,status,selected_by,created_at,updated_at) VALUES (?,?,?,?,'APPROVED','USER',?,?)")
      .run(randomUUID(), f.h.projectId, f.ids[0], cool.id, at, at);
    const visuals = new VisualService(f.h.sqlite, f.h.repository, f.h.config);
    expect(await visuals.repairPickNextCandidate(f.h.projectId, f.ids[0])).toMatchObject({ changed: false });
    expect(visuals.getSceneVisuals(f.h.projectId, f.ids[0]).selection?.candidateId).toBe(cool.id);
  });

  it("TASK-141 P1: without validated shots, a long scene does not penalise the palette match in continuityRank", async () => {
    const f = setup(); f.save();
    f.h.sqlite.prepare("UPDATE scenes SET duration_override_sec=60 WHERE id=?").run(f.ids[0]);
    await candidate(f, f.ids[0], "#2244bb");
    const warm = await candidate(f, f.ids[0], "#df9c51");
    const visuals = new VisualService(f.h.sqlite, f.h.repository, f.h.config);
    // Fallback là mục tiêu nhịp (5s) nên thành phần nhịp trung tính; scene 60s không được làm mọi ứng viên về 0 rồi hòa.
    expect(await visuals.repairPickNextCandidate(f.h.projectId, f.ids[0])).toMatchObject({ changed: true, candidateId: warm.id });
  });

  it("measures a warm/cool jump, long pacing and missing motif, skipping unconfigured character vision", async () => {
    const f = setup(); f.save();
    const picks = [await candidate(f, f.ids[0], "#df9c51"), await candidate(f, f.ids[1], "#2244bb")];
    const at = f.h.clock().toISOString();
    picks.forEach((pick) => f.h.sqlite.prepare("INSERT INTO visual_selections(id,project_id,scene_id,candidate_id,status,selected_by,created_at,updated_at) VALUES (?,?,?,?,'APPROVED','USER',?,?)")
      .run(randomUUID(), f.h.projectId, pick.sceneId, pick.id, at, at));
    f.h.sqlite.prepare("UPDATE scenes SET duration_override_sec=15 WHERE id=?").run(f.ids[1]);
    f.plan.motifs = [{ id: "river", description: "River motif", scenes: [f.ids[1]] }]; f.save();
    const report = await checkContinuity(f.h.projectId, f.h.sqlite, f.h.config);
    // TASK-141 P1: không có shot đã kiểm chứng thì độ dài cảnh KHÔNG được coi là nhịp đo được, nên không có finding pacing.
    expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["color_jump", "motif_missing"]));
    expect(report.findings.map((finding) => finding.code)).not.toContain("pacing");
    expect(report.characterCheck).toBe("skipped");
    expect(report.characterReason).toContain("không suy đoán");
    expect(report.estimatedPacing).toBe(true);
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 3);
  });

  it("keeps estimatedPacing true when only voice tracks exist (TASK-141 P1: voice timing is not cut rhythm)", async () => {
    const f = setup(); f.save();
    const now = f.h.clock().toISOString();
    const insertTrack = f.h.sqlite.prepare(`INSERT INTO voice_tracks(id,project_id,scene_id,provider,voice,rate,origin,audio_path,duration_sec,cues,words,timing_source,input_hash,narration_hash,created_at,updated_at)
      VALUES (?,?,?,'mock','voice',1,'AGENT','dummy.mp3',?,'[]','[]','estimated','h1','h2',?,?)`);
    insertTrack.run(randomUUID(), f.h.projectId, f.ids[0], 4.8, now, now);
    insertTrack.run(randomUUID(), f.h.projectId, f.ids[1], 5.1, now, now);
    const report = await checkContinuity(f.h.projectId, f.h.sqlite, f.h.config);
    expect(report.estimatedPacing).toBe(true);
  });

  it("TASK-141 P1: pacing findings come only from a validated compose plan with shots", async () => {
    const f = setup(); f.save();
    f.h.sqlite.prepare("UPDATE scenes SET duration_override_sec=20 WHERE id IN (?,?)").run(f.ids[0], f.ids[1]);
    const renderDir = join(projectDir(f.h.config.DATA_DIR, f.h.projectId), "render");
    mkdirSync(renderDir, { recursive: true });
    const oneLongShot = [{ startSec: 0, endSec: 20 }];
    const fourShortShots = [0, 5, 10, 15].map((start) => ({ startSec: start, endSec: start + 5 }));
    writeFileSync(join(renderDir, "compose-plan.json"), JSON.stringify({ version: 1, engine: "compose", preset: "documentary", aspect: "16:9",
      scenes: [{ sceneId: f.ids[0], durationSec: 20, shots: oneLongShot }, { sceneId: f.ids[1], durationSec: 20, shots: fourShortShots }],
      stats: {}, footageNotes: [] }));
    const report = await checkContinuity(f.h.projectId, f.h.sqlite, f.h.config);
    expect(report.estimatedPacing).toBe(false);
    // Chỉ cảnh có shot 20s (lệch quá 40% so với body) bị gắn pacing; bốn shot 5s trong cảnh 20s thì không.
    expect(report.findings.filter((finding) => finding.code === "pacing").map((finding) => finding.sceneIds)).toEqual([[f.ids[0]]]);
  });

  it("TASK-141 P1: a 7.4s scene with no validated shots gets no pacing finding", async () => {
    const f = setup(); f.save();
    f.h.sqlite.prepare("UPDATE scenes SET duration_override_sec=7.4 WHERE id=?").run(f.ids[0]);
    const report = await checkContinuity(f.h.projectId, f.h.sqlite, f.h.config);
    expect(report.findings.map((finding) => finding.code)).not.toContain("pacing");
    expect(report.estimatedPacing).toBe(true);
  });

  it("does not change inputVersion when checkContinuity runs", async () => {
    const f = setup(); f.save();
    const versions = new StageInputVersions(f.h.sqlite, f.h.config.DATA_DIR);
    const before = versions.inputVersion(f.h.projectId, "VISUAL_SEARCH");
    await checkContinuity(f.h.projectId, f.h.sqlite, f.h.config, { registry: f.registry, context: f.context });
    expect(versions.inputVersion(f.h.projectId, "VISUAL_SEARCH")).toBe(before);
  });

  it("safely handles malformed JSON in visual_queries without crashing", () => {
    const f = setup();
    f.h.sqlite.prepare("UPDATE scenes SET visual_queries = 'MALFORMED_JSON{' WHERE id = ?").run(f.ids[0]);
    expect(() => readContinuity(f.h.sqlite, f.h.projectId)).not.toThrow();
    expect(readContinuity(f.h.sqlite, f.h.projectId)).toBeUndefined();
  });

  it("runs batched vision check when vision is configured and outputs character mismatch", async () => {
    const f = setup(); f.save();
    const picks = [await candidate(f, f.ids[0], "#df9c51"), await candidate(f, f.ids[1], "#2244bb")];
    const at = f.h.clock().toISOString();
    picks.forEach((pick) => f.h.sqlite.prepare("INSERT INTO visual_selections(id,project_id,scene_id,candidate_id,status,selected_by,created_at,updated_at) VALUES (?,?,?,?,'APPROVED','AGENT',?,?)")
      .run(randomUUID(), f.h.projectId, pick.sceneId, pick.id, at, at));

    const mockProvider = f.registry.get("mock")!;
    mockProvider.capabilities = { ...mockProvider.capabilities, vision: true, maxImagesPerCall: 5 };
    const generate = vi.spyOn(mockProvider, "generate").mockImplementation(async (req) => ({
      text: JSON.stringify({ findings: [{ sceneIds: [f.ids[0], f.ids[1]], reason: "Different jacket style and hair color." }] }),
      usage: { inputTokens: 100, outputTokens: 40 },
      model: req.model,
      provider: "mock",
      finishReason: "stop",
    }));

    const report = await checkContinuity(f.h.projectId, f.h.sqlite, f.h.config, { registry: f.registry, context: f.context });
    expect(report.characterCheck).toBe("checked");
    expect(report.characterReason).toContain("batch vision");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "character_mismatch",
        sceneIds: [f.ids[0], f.ids[1]],
        message: "Different jacket style and hair color.",
      }),
    ]));
    expect(generate).toHaveBeenCalled();
  });

  it("executes get_continuity_plan and check_continuity read tools", async () => {
    const f = setup(); f.save();
    const planTool = continuityToolDefs.find((t) => t.name === "get_continuity_plan")!;
    const checkTool = continuityToolDefs.find((t) => t.name === "check_continuity")!;
    const ctx = {
      scenes: f.service,
      sqlite: f.h.sqlite,
      config: f.h.config,
    } as any;
    const planResult = await planTool.execute({ projectId: f.h.projectId }, ctx);
    expect(planResult).toMatchObject({ plan: f.plan });

    const checkResult = await checkTool.execute({ projectId: f.h.projectId }, ctx);
    expect(checkResult).toMatchObject({ dimension: "continuity", estimatedPacing: true });
  });
});
