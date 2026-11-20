import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { recordStageNotes } from "../src/learning/stageLessons.js";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE stage_feedback (id TEXT PRIMARY KEY, profile_id TEXT, stage TEXT, kind TEXT, target TEXT, before TEXT, after TEXT, reason TEXT, distilled_at TEXT, created_at TEXT);
    CREATE TABLE stage_notes (id TEXT PRIMARY KEY, profile_id TEXT, stage TEXT, text TEXT, evidence_ids TEXT, status TEXT, created_at TEXT, uses INTEGER DEFAULT 0, last_used_at TEXT, decided_at TEXT, decided_by TEXT);
  `);
  const ins = sqlite.prepare("INSERT INTO stage_feedback (id, profile_id, stage, kind, target, created_at) VALUES (?, 'p1', 'SCRIPT', 'user_edit', 'x', '2026-11-18')");
  for (const id of ["f1", "f2", "f3"]) ins.run(id);
  return sqlite;
}

describe("operator stage-note proposals (TASK-148a)", () => {
  it("stores proposed notes only with evidence from undistilled rows and marks that evidence distilled", () => {
    const sqlite = makeDb();
    const result = recordStageNotes(sqlite, {
      profileId: "p1",
      stage: "SCRIPT",
      notes: [
        { text: "Mở đầu bằng câu hỏi.", evidenceIds: ["f1", "f2", "ghost"], confidence: 0.8 },
        { text: "Không có chứng cứ.", evidenceIds: ["ghost2"], confidence: 0.5 },
      ],
    });
    expect(result).toEqual({ proposed: 1, skipped: 1 });
    const notes = sqlite.prepare("SELECT status, evidence_ids AS e FROM stage_notes").all() as Array<{ status: string; e: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0].status).toBe("proposed");
    expect(JSON.parse(notes[0].e)).toEqual(["f1", "f2"]);
    const distilled = sqlite.prepare("SELECT id FROM stage_feedback WHERE distilled_at IS NOT NULL ORDER BY id").all() as Array<{ id: string }>;
    expect(distilled.map((row) => row.id)).toEqual(["f1", "f2"]);
  });

  it("rejects more than five notes and an empty evidence list", () => {
    const sqlite = makeDb();
    const six = Array.from({ length: 6 }, (_, i) => ({ text: `n${i}`, evidenceIds: ["f1"], confidence: 0.5 }));
    expect(() => recordStageNotes(sqlite, { profileId: "p1", stage: "SCRIPT", notes: six })).toThrow();
    expect(() => recordStageNotes(sqlite, { profileId: "p1", stage: "SCRIPT", notes: [{ text: "x", evidenceIds: [], confidence: 0.5 }] })).toThrow();
  });
});
