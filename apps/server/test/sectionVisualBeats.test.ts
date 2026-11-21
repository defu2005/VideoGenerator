import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sceneVisualBeat, sectionVisualBeats } from "../src/timeline/sceneBeats.js";

// TASK-146 slice 2 commit B: visualIntent and beatPurpose per script section, resolved by section id.

function scriptDb(sections: unknown[]) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE scripts (project_id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  db.prepare("INSERT INTO scripts (project_id, data) VALUES (?, ?)").run("P", JSON.stringify({ sections }));
  return db;
}

describe("sectionVisualBeats", () => {
  it("returns a trimmed intent and a valid purpose for a section that has both", () => {
    const db = scriptDb([{ id: "s1", beatPurpose: "reveal", visualIntent: "  the finished machine  " }]);
    expect(sectionVisualBeats(db, "P").get("s1")).toEqual({ visualIntent: "the finished machine", beatPurpose: "reveal" });
  });

  it("drops an invalid purpose but keeps the intent", () => {
    const db = scriptDb([{ id: "s2", beatPurpose: "bogus", visualIntent: "a workbench" }]);
    expect(sectionVisualBeats(db, "P").get("s2")).toEqual({ visualIntent: "a workbench" });
  });

  it("drops an empty or blank intent", () => {
    const db = scriptDb([{ id: "s3", beatPurpose: "setup", visualIntent: "   " }]);
    expect(sectionVisualBeats(db, "P").get("s3")).toEqual({ beatPurpose: "setup" });
  });

  it("gives nothing for a scene with a null section id (hook, outro, translated child)", () => {
    const db = scriptDb([{ id: "s1", beatPurpose: "reveal", visualIntent: "x" }]);
    expect(sceneVisualBeat(sectionVisualBeats(db, "P"), null)).toBeUndefined();
  });

  it("gives nothing for a translated child, whose section id is a parent scene id", () => {
    const db = scriptDb([{ id: "s1", beatPurpose: "reveal", visualIntent: "x" }]);
    expect(sceneVisualBeat(sectionVisualBeats(db, "P"), "parent-scene-id")).toBeUndefined();
  });

  it("returns an empty map when the project has no script row", () => {
    const db = scriptDb([]);
    expect(sectionVisualBeats(db, "MISSING").size).toBe(0);
  });
});
