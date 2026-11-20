import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportProjectSnapshot, importProjectSnapshot } from "../src/node/projectSnapshot.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { projectDir } from "../src/storage/paths.js";
import { StageInputVersions } from "../src/pipeline/inputVersion.js";
import { ProfileDefaultBriefSchema, GuidelineSettingsSchema, snapshotKnowledge } from "@vg/shared";
import { KnowledgeService } from "../src/knowledge/service.js";

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((h) => h.close()));
function harness() { const h = createPipelineHarness(); fixtures.push(h); return h; }

describe("project content snapshot", () => {
  it("carries only the linked channel context and parsed routing, with credentials excluded", () => {
    const source = harness(), target = harness(), at = source.clock().toISOString();
    source.sqlite.prepare("UPDATE projects SET workspace_id='A',profile_id=NULL WHERE id=?").run(source.projectId);
    const insert = source.sqlite.prepare("INSERT INTO profiles(id,workspace_id,name,default_brief,guidelines,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
    insert.run("channel-A", "A", "Channel A", JSON.stringify(ProfileDefaultBriefSchema.parse({})), JSON.stringify(GuidelineSettingsSchema.parse({})), at, at);
    insert.run("channel-B", "B", "Foreign channel", JSON.stringify(ProfileDefaultBriefSchema.parse({})), JSON.stringify(GuidelineSettingsSchema.parse({})), at, at);
    source.sqlite.prepare("UPDATE projects SET profile_id='channel-A' WHERE id=?").run(source.projectId);
    source.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES ('llmRouting',?,?)").run(JSON.stringify({ default: { provider: "mock" }, apiKey: "do-not-send" }), at);
    const snapshot = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    expect(snapshot.context.profiles.map((row) => row.id)).toEqual(["channel-A"]);
    expect(JSON.stringify(snapshot)).not.toContain("do-not-send");
    expect(JSON.stringify(snapshot)).not.toContain("Foreign channel");
    target.sqlite.prepare("DELETE FROM projects").run();
    importProjectSnapshot(target.sqlite, snapshot, () => { throw new Error("no files"); });
    expect(exportProjectSnapshot(target.sqlite, target.config.DATA_DIR, snapshot.projectId)).toEqual(snapshot);
    const foreign = structuredClone(snapshot); foreign.context.profiles[0]!.workspace_id = "B";
    const empty = harness(); empty.sqlite.prepare("DELETE FROM projects").run();
    expect(() => importProjectSnapshot(empty.sqlite, foreign, () => "")).toThrowError(expect.objectContaining({ code: "SNAPSHOT_CONTEXT_SCOPE" }));
    expect(empty.sqlite.prepare("SELECT COUNT(*) AS n FROM profiles").get()).toEqual({ n: 0 });
  });

  it("round trips content and the complete file manifest without control or foreign project rows", () => {
    const source = harness(), target = harness();
    source.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(source.projectId);
    const path = join(projectDir(source.config.DATA_DIR, source.projectId), "thumbnail.png");
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "snapshot image");
    source.sqlite.prepare("UPDATE projects SET thumbnail_path=? WHERE id=?").run("thumbnail.png", source.projectId);
    source.sqlite.prepare("INSERT INTO visual_search_checkpoints(scene_id,project_id,search_hash,queries,candidates,created_at) VALUES ('scene-1',?,'hash','[\"example\"]',?,?)")
      .run(source.projectId, JSON.stringify([{ localPath: "thumbnail.png", renderPath: "static", graphicPath: "animated" }]), source.clock().toISOString());
    source.repository.createJob({ projectId: source.projectId, stage: "RESEARCH", maxAttempts: 1, previousState: "PENDING", runAfter: source.clock() });
    source.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES ('secret','never-export',?)").run(source.clock().toISOString());
    const snapshot = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0]!.name).toMatch(/^files\/[a-f0-9]{64}\.png$/);
    expect(snapshot.tables.jobs).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("never-export");
    expect(JSON.stringify(snapshot)).not.toContain(source.config.DATA_DIR.replaceAll("\\", "\\\\"));
    target.sqlite.prepare("DELETE FROM projects").run();
    importProjectSnapshot(target.sqlite, snapshot, (file) => {
      const local = join(projectDir(target.config.DATA_DIR, snapshot.projectId), file.name);
      mkdirSync(dirname(local), { recursive: true }); copyFileSync(path, local); return local;
    });
    expect(exportProjectSnapshot(target.sqlite, target.config.DATA_DIR, snapshot.projectId)).toEqual(snapshot);
    expect(new StageInputVersions(target.sqlite, target.config.DATA_DIR).inputVersion(snapshot.projectId, "SCRIPT"))
      .toBe(source.orchestrator.inputVersions.inputVersion(snapshot.projectId, "SCRIPT"));
    expect(new StageInputVersions(target.sqlite, target.config.DATA_DIR).inputVersion(snapshot.projectId, "VISUAL_REVIEW"))
      .toBe(source.orchestrator.inputVersions.inputVersion(snapshot.projectId, "VISUAL_REVIEW"));
    expect(target.sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 0 });
  });

  it("rejects schema changes, injected control tables, and rows for another project before import", () => {
    const source = harness(), target = harness(); target.sqlite.prepare("DELETE FROM projects").run();
    const snapshot = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    const resolveFile = () => { throw new Error("no files expected"); };
    expect(() => importProjectSnapshot(target.sqlite, { ...snapshot, schemaHash: "old" }, resolveFile)).toThrowError(expect.objectContaining({ code: "NODE_SCHEMA_MISMATCH" }));
    expect(() => importProjectSnapshot(target.sqlite, { ...snapshot, tables: { ...snapshot.tables, jobs: [] } }, resolveFile)).toThrowError(expect.objectContaining({ code: "SNAPSHOT_TABLE_INVALID" }));
    const changed = structuredClone(snapshot); changed.tables.projects![0]!.id = target.projectId;
    expect(() => importProjectSnapshot(target.sqlite, changed, resolveFile)).toThrowError(expect.objectContaining({ code: "SNAPSHOT_PROJECT_INVALID" }));
    expect(target.sqlite.prepare("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  });

  it("rejects missing inputs rather than silently shipping unusable paths", () => {
    const source = harness();
    source.sqlite.prepare("UPDATE projects SET thumbnail_path='missing.png' WHERE id=?").run(source.projectId);
    expect(() => exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId)).toThrowError(expect.objectContaining({ code: "SNAPSHOT_FILE_MISSING" }));
  });

  it("preserves exclusions without copying excluded text into a node", () => {
    const source = harness(), target = harness(), at = source.clock().toISOString();
    source.sqlite.prepare("INSERT INTO retrieval_chunks(id,kind,source_id,source_version,content_hash,title,text,created_at,updated_at) VALUES (1,'memory','example','1','hash','title','excluded private text',?,?)").run(at, at);
    source.sqlite.prepare("INSERT INTO retrieval_exclusions(project_id,chunk_id,created_at) VALUES (?,1,?)").run(source.projectId, at);
    const snapshot = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    expect(snapshot.context.excludedChunkIds).toEqual([1]);
    expect(JSON.stringify(snapshot)).not.toContain("excluded private text");
    target.sqlite.prepare("DELETE FROM projects").run();
    importProjectSnapshot(target.sqlite, snapshot, () => { throw new Error("no files"); });
    expect(exportProjectSnapshot(target.sqlite, target.config.DATA_DIR, source.projectId)).toEqual(snapshot);
  });

  it("copies current accepted knowledge in the project workspace, without revision history or another workspace", () => {
    const source = harness(), target = harness(), entry = snapshotKnowledge("guideline.youtube")!, at = source.clock().toISOString();
    source.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(source.projectId);
    const insert = source.sqlite.prepare("INSERT INTO knowledge_entries(id,workspace_id,key,kind,json,revision,updated_at) VALUES (?,?,?,?,?,1,?)");
    insert.run("accepted-A", "A", entry.id, entry.kind, JSON.stringify(entry), at);
    insert.run("accepted-B", "B", entry.id, entry.kind, JSON.stringify({ ...entry, note: "foreign knowledge" }), at);
    const snapshot = exportProjectSnapshot(source.sqlite, source.config.DATA_DIR, source.projectId);
    expect(snapshot.context.knowledge.map((row) => row.id)).toEqual(["accepted-A"]);
    expect(JSON.stringify(snapshot)).not.toContain("foreign knowledge");
    target.sqlite.prepare("DELETE FROM projects").run();
    importProjectSnapshot(target.sqlite, snapshot, () => { throw new Error("no files"); });
    expect(new KnowledgeService(target.sqlite, source.clock).get(entry.id)).toMatchObject({ layer: "accepted", revision: 1, entry });
    expect(exportProjectSnapshot(target.sqlite, target.config.DATA_DIR, source.projectId)).toEqual(snapshot);
  });
});
