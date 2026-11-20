import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { PROJECT_TABLES, projectTableRows, unregisteredProjectTables } from "../src/pipeline/dataContract.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { markStaleFrom } from "../src/pipeline/invalidation.js";
import { STALE_INPUT_MESSAGE } from "../src/pipeline/orchestrator.js";
import { STAGE_ORDER } from "@vg/shared";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProjectDir } from "../src/storage/paths.js";
import { randomUUID } from "node:crypto";

describe("project table registry", () => {
  it("covers migrated project and scene tables and flags newly added ones", () => {
    const { db, sqlite } = openDatabase(":memory:");
    try {
      migrateDatabase(db, undefined, sqlite);
      expect(unregisteredProjectTables(sqlite)).toEqual([]);
      const names = PROJECT_TABLES.map(({ table }) => getTableName(table));
      expect(new Set(names).size).toBe(names.length);
      for (const entry of PROJECT_TABLES) expect(projectTableRows(sqlite, entry, "fixture-missing-project")).toEqual([]);

      sqlite.exec(`CREATE TEMP TABLE unfinished_stage_output (project_id TEXT);
        CREATE TEMP TABLE unfinished_scene_output (scene_id TEXT);`);
      expect(unregisteredProjectTables(sqlite)).toEqual(["unfinished_scene_output", "unfinished_stage_output"]);
    } finally { sqlite.close(); }
  });
});

function scriptFixture(h: ReturnType<typeof createPipelineHarness>) {
  h.sqlite.prepare(`INSERT INTO scripts(project_id,data,origin,input_hash,updated_at) VALUES (?,?,'USER','fixture',?)`)
    .run(h.projectId, JSON.stringify({ title: "Test", body: "Original" }), h.clock().toISOString());
}

describe("pipeline input versions", () => {
  it("uses stable upstream rows and file contents, ignoring timestamps and downstream rows", () => {
    const h = createPipelineHarness();
    try {
      scriptFixture(h);
      const versions = h.orchestrator.inputVersions;
      const scenePlan = () => versions.inputVersion(h.projectId, "SCENE_PLAN");
      const first = scenePlan();
      const settings = h.repository.getProject(h.projectId)!.settings;
      h.sqlite.prepare("UPDATE projects SET settings=? WHERE id=?").run(JSON.stringify(settings), h.projectId);
      expect(scenePlan()).toBe(first);
      h.sqlite.prepare("UPDATE scripts SET data=?, updated_at=? WHERE project_id=?")
        .run(JSON.stringify({ body: "Original", title: "Test" }), "2026-01-01T00:00:00Z", h.projectId);
      expect(scenePlan()).toBe(first);
      h.sqlite.prepare("INSERT INTO timelines(project_id,data,input_hash,total_duration_sec,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run(h.projectId, JSON.stringify({ clip: { path: "sample.mp4" } }), "timeline", 1, h.clock().toISOString(), h.clock().toISOString());
      expect(scenePlan()).toBe(first);
      h.sqlite.prepare("UPDATE scripts SET data=? WHERE project_id=?").run(JSON.stringify({ body: "Changed" }), h.projectId);
      expect(scenePlan()).not.toBe(first);
      const directory = createProjectDir(h.config.DATA_DIR, h.projectId);
      const render = () => versions.inputVersion(h.projectId, "RENDER");
      const absent = render();
      writeFileSync(join(directory, "sample.mp4"), "first");
      const present = render();
      expect(present).not.toBe(absent);
      writeFileSync(join(directory, "copy.mp4"), "first");
      h.sqlite.prepare("UPDATE timelines SET data=? WHERE project_id=?").run(JSON.stringify({ clip: { path: "copy.mp4" } }), h.projectId);
      expect(render()).toBe(present);
      writeFileSync(join(directory, "copy.mp4"), "other");
      expect(render()).not.toBe(present);
    } finally { h.close(); }
  });

  it("keeps completed work, reruns once if inputs changed, and accepts matching versions", () => {
    const h = createPipelineHarness({ mode: "AUTO", autoRender: true });
    try {
      scriptFixture(h);
      for (const stage of STAGE_ORDER.filter((stage) => stage !== "RENDER")) h.repository.updateStage(h.projectId, stage, { state: "DONE" });
      const queued = h.orchestrator.runAll(h.projectId).activeJob!;
      expect(queued.inputVersion).toMatch(/^[a-f0-9]{64}$/);
      h.orchestrator.startJob(queued.id);
      h.sqlite.prepare("UPDATE scripts SET data=? WHERE project_id=?").run('{"body":"Edited live"}', h.projectId);
      const renderId = randomUUID();
      h.sqlite.prepare(`INSERT INTO renders(id,project_id,input_hash,status,output_path,duration_sec,size_bytes,width,height,report,created_at)
        VALUES (?,?,'fixture','DONE','output.mp4',1,1,16,9,'{}',?)`).run(renderId, h.projectId, h.clock().toISOString());
      h.orchestrator.completeJob(queued.id, "render artifact ready", renderId);
      expect(h.repository.getJob(queued.id)).toMatchObject({ status: "SUCCEEDED", message: STALE_INPUT_MESSAGE });
      expect(h.sqlite.prepare("SELECT json_extract(report, '$.staleInput') AS stale FROM renders WHERE id=?").get(renderId)).toEqual({ stale: 1 });
      const retry = h.repository.getActiveJobs(h.projectId)[0]!;
      expect(retry).toMatchObject({ stage: "RENDER", status: "QUEUED" });
      expect(h.repository.isInputRetry(retry.id)).toBe(true);
      h.orchestrator.startJob(retry.id);
      markStaleFrom(h.repository, h.projectId, "SCRIPT");
      expect(h.repository.getJob(retry.id)?.invalidatedAt).toBeTruthy();
      h.orchestrator.completeJob(retry.id);
      expect(h.repository.getStage(h.projectId, "RENDER")).toMatchObject({ state: "STALE", message: STALE_INPUT_MESSAGE });
      expect(h.repository.getActiveJobs(h.projectId)).toEqual([]);
      h.repository.updateStage(h.projectId, "FINAL_APPROVAL", { state: "DONE" });
      const fresh = h.orchestrator.runRender(h.projectId).activeJob!;
      const started = h.orchestrator.startJob(fresh.id)!;
      h.orchestrator.completeJob(fresh.id);
      expect(h.repository.getStage(h.projectId, "RENDER")).toMatchObject({ state: "DONE", inputVersion: started.inputVersion });
    } finally { h.close(); }
  });
});
