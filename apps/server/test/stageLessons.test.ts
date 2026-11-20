import { describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { recordStageFeedback } from "../src/learning/stageFeedback.js";
import { decideStageNote, distillStageFeedback, stageLessons, type LessonProposer } from "../src/learning/stageLessons.js";

function seedRows(h: ReturnType<typeof createPipelineHarness>, profileId: string, count: number, stage = "SCRIPT") {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(recordStageFeedback(h.sqlite, { projectId: h.projectId, profileId, stage, kind: "user_edit", target: "hook", before: `a${i}`, after: `b${i}`, source: "user" })!);
  }
  return ids;
}

function profileOf(h: ReturnType<typeof createPipelineHarness>): string {
  return (h.sqlite.prepare("SELECT profile_id AS p FROM projects WHERE id = ?").get(h.projectId) as { p: string }).p;
}

describe("stage lessons (TASK-148a/b)", () => {
  it("does nothing below the 5-row threshold and marks nothing distilled", async () => {
    const h = createPipelineHarness();
    const profileId = profileOf(h);
    seedRows(h, profileId, 4);
    let called = false;
    const propose: LessonProposer = async () => { called = true; return { notes: [] }; };
    expect(await distillStageFeedback(h.sqlite, { profileId, stage: "SCRIPT", propose })).toBe(0);
    expect(called).toBe(false);
    const open = h.sqlite.prepare("SELECT COUNT(*) AS n FROM stage_feedback WHERE distilled_at IS NULL").get() as { n: number };
    expect(open.n).toBe(4);
  });

  it("proposes notes backed only by real evidence, then marks the batch distilled", async () => {
    const h = createPipelineHarness();
    const profileId = profileOf(h);
    const ids = seedRows(h, profileId, 5);
    const propose: LessonProposer = async () => ({
      notes: [
        { text: "Mở đầu bằng câu hỏi cụ thể.", evidenceIds: [ids[0], ids[1], "forged-id"], confidence: 0.8 },
        { text: "Không có bằng chứng.", evidenceIds: ["forged-only"], confidence: 0.9 },
      ],
    });
    expect(await distillStageFeedback(h.sqlite, { profileId, stage: "SCRIPT", propose })).toBe(1);
    const note = h.sqlite.prepare("SELECT status, evidence_ids AS e FROM stage_notes").all() as Array<{ status: string; e: string }>;
    expect(note).toHaveLength(1);
    expect(note[0].status).toBe("proposed");
    expect(JSON.parse(note[0].e)).toEqual([ids[0], ids[1]]);
    const open = h.sqlite.prepare("SELECT COUNT(*) AS n FROM stage_feedback WHERE distilled_at IS NULL").get() as { n: number };
    expect(open.n).toBe(0);
  });

  it("rejects a proposal that breaks the schema, such as more than 5 notes", async () => {
    const h = createPipelineHarness();
    const profileId = profileOf(h);
    seedRows(h, profileId, 5);
    const notes = Array.from({ length: 6 }, (_, i) => ({ text: `n${i}`, evidenceIds: ["x"], confidence: 0.5 }));
    await expect(distillStageFeedback(h.sqlite, { profileId, stage: "SCRIPT", propose: async () => ({ notes }) })).rejects.toThrow();
  });

  it("serves only approved notes for the channel plus global ones, and counts uses", () => {
    const h = createPipelineHarness();
    const profileId = profileOf(h);
    const insert = (id: string, pid: string | null, status: string, text: string) =>
      h.sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES (?, ?, 'SCRIPT', ?, '[]', ?, ?, 0)")
        .run(id, pid, text, status, new Date().toISOString());
    insert("n-ok", profileId, "approved", "channel rule");
    insert("n-global", null, "approved", "global rule");
    insert("n-prop", profileId, "proposed", "not yet");
    insert("n-other", "other-profile", "approved", "other channel");
    const lessons = stageLessons(h.sqlite, profileId, "SCRIPT");
    expect(lessons.sort()).toEqual(["channel rule", "global rule"]);
    const uses = h.sqlite.prepare("SELECT uses FROM stage_notes WHERE id = 'n-ok'").get() as { uses: number };
    expect(uses.uses).toBe(1);
  });

  it("approve, reject, retire and undo move a note between states", () => {
    const h = createPipelineHarness();
    const profileId = profileOf(h);
    h.sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES ('n1', ?, 'SCRIPT', 'rule', '[\"e\"]', 'proposed', ?, 0)")
      .run(profileId, new Date().toISOString());
    expect(() => decideStageNote(h.sqlite, { id: "n1", decision: "undo", decidedBy: "user" })).toThrow("STAGE_NOTE_NOT_DECIDED");
    expect(decideStageNote(h.sqlite, { id: "n1", decision: "approve", decidedBy: "user" }).status).toBe("approved");
    expect(decideStageNote(h.sqlite, { id: "n1", decision: "undo", decidedBy: "user" }).status).toBe("proposed");
    expect(decideStageNote(h.sqlite, { id: "n1", decision: "reject", decidedBy: "user" }).status).toBe("rejected");
    expect(decideStageNote(h.sqlite, { id: "n1", decision: "retire", decidedBy: "user" }).status).toBe("retired");
    expect(() => decideStageNote(h.sqlite, { id: "missing", decision: "approve", decidedBy: "user" })).toThrow("STAGE_NOTE_NOT_FOUND");
  });
});

// TASK-148b: approved per-stage lessons reach the profile notes only for the stage that asked.
describe("stage lessons reach the prompt context (TASK-148b)", () => {
  it("adds approved SCRIPT lessons under the stage heading and omits them for other stages", async () => {
    const { getProfilePromptContext } = await import("../src/services/profileService.js");
    const h = createPipelineHarness();
    const profileId = "prof-lesson-test";
    h.sqlite.prepare("INSERT INTO profiles (id, name, default_brief, guidelines, created_at, updated_at) VALUES (?, 'Kênh bài học', '{}', '{}', ?, ?)").run(profileId, new Date().toISOString(), new Date().toISOString());
    h.sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES ('p1', ?, 'SCRIPT', 'Mở đầu bằng câu hỏi.', '[]', 'approved', ?, 0)")
      .run(profileId, new Date().toISOString());
    const script = getProfilePromptContext(h.sqlite, profileId, "SCRIPT");
    expect(script.learnedNotes).toContain("Bài học theo bước SCRIPT:");
    expect(script.learnedNotes).toContain("- Mở đầu bằng câu hỏi.");
    const other = getProfilePromptContext(h.sqlite, profileId, "VISUAL_SEARCH");
    expect(other.learnedNotes ?? "").not.toContain("Mở đầu bằng câu hỏi.");
  });
});
