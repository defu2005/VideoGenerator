import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scriptGateDecision } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { scriptGateInputs } from "../src/operator/qualityGates.js";

// TASK-145 record test: observed result of the SCRIPT quality gate for a score of 5.5 with one blocking fact.
// Real in-memory database, default settings (no goal, no project override), no network.
// Records what the current code does. It does not assert a fix for the floor-0 gap.
let opened: ReturnType<typeof openDatabase>;
let projectId: string;

beforeEach(() => {
  opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  projectId = randomUUID();
  const at = "2026-11-18T03:00:00.000Z";
  opened.sqlite.prepare(
    `INSERT INTO projects (id, title, topic, mode, settings, status, stage, created_at, updated_at)
     VALUES (?, 'TASK-145 hold floor', 'TASK-145', 'AUTO', '{}', 'ACTIVE', 'SCRIPT', ?, ?)`,
  ).run(projectId, at, at);
  opened.sqlite.prepare(
    `INSERT INTO scripts (project_id, data, origin, input_hash, updated_at, quality_score, blocking_facts, revise_round)
     VALUES (?, '{}', 'test', 'hash-145', ?, 5.5, 1, 0)`,
  ).run(projectId, at);
});

afterEach(() => opened.sqlite.close());

describe("TASK-145 record: SCRIPT gate at score 5.5 with one blocking fact", () => {
  it("reads score 5.5, blocking fact 1, revise round 0, minQualityScore 7 (default)", () => {
    const input = scriptGateInputs(opened.sqlite, projectId);
    expect(input).toEqual({
      score: 5.5,
      blockingFacts: 1,
      reviseRound: 0,
      guidelinePass: true,
      minQualityScore: 7,
    });
  });

  it("revises a 5.5 script with one blocking fact while revise budget remains (round 0 < maxRevise 2)", () => {
    const input = scriptGateInputs(opened.sqlite, projectId);
    expect(scriptGateDecision(input)).toBe("revise");
  });
});
