import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { missionPreview } from "../src/missions/preview.js";

// TASK-129c: the autonomy preview follows the gate path (project.mode, autoRender), not the profile autonomy level.
function db() {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT, mode TEXT, settings TEXT)");
  const add = (id: string, mode: string, settings: object) =>
    sqlite.prepare("INSERT INTO projects (id, title, mode, settings) VALUES (?, ?, ?, ?)").run(id, id, mode, JSON.stringify(settings));
  add("manual", "MANUAL", {});
  add("auto", "AUTO", {});
  add("auto-render", "AUTO", { autoRender: true });
  add("manual-script", "MANUAL", { scriptOutlineApproval: "script" });
  add("auto-script", "AUTO", { scriptOutlineApproval: "script" });
  return sqlite;
}

// The default (off) script review passes at once, so only the other gates are checked for stopping.
const stopsExceptScriptReview = (gates: { gate: string; stopsForUser: boolean }[]) =>
  gates.filter((gate) => gate.gate !== "SCRIPT_REVIEW").every((gate) => gate.stopsForUser);

describe("mission gate preview", () => {
  it("a planning mission with no projects says gates follow each project's mode", () => {
    const preview = missionPreview(db(), { projectIds: [] });
    expect(preview.projects).toEqual([]);
    expect(preview.note).toContain("Chưa gắn dự án");
    expect(preview.alwaysStops.length).toBeGreaterThan(0);
  });

  it("a MANUAL project stops at every gate except script review, which is off by default", () => {
    const [project] = missionPreview(db(), { projectIds: ["manual"] }).projects;
    expect(stopsExceptScriptReview(project!.gates)).toBe(true);
    expect(project!.gates.find((gate) => gate.gate === "SCRIPT_REVIEW")?.stopsForUser).toBe(false);
  });

  it("a MANUAL project with script outline approval set to script stops at every gate", () => {
    const [project] = missionPreview(db(), { projectIds: ["manual-script"] }).projects;
    expect(project!.gates.every((gate) => gate.stopsForUser)).toBe(true);
  });

  it("an AUTO project auto-approves review gates but stops at final approval without autoRender", () => {
    const [project] = missionPreview(db(), { projectIds: ["auto"] }).projects;
    const byGate = Object.fromEntries(project!.gates.map((gate) => [gate.gate, gate.stopsForUser]));
    expect(byGate.VISUAL_REVIEW).toBe(false);
    expect(byGate.MUSIC_REVIEW).toBe(false);
    expect(byGate.FINAL_APPROVAL).toBe(true);
  });

  it("an AUTO project with script outline approval waits at script review but auto-approves the other review gates", () => {
    const [project] = missionPreview(db(), { projectIds: ["auto-script"] }).projects;
    const byGate = Object.fromEntries(project!.gates.map((gate) => [gate.gate, gate.stopsForUser]));
    expect(byGate.SCRIPT_REVIEW).toBe(true);
    expect(byGate.VISUAL_REVIEW).toBe(false);
    expect(byGate.MUSIC_REVIEW).toBe(false);
  });

  it("an AUTO project with autoRender auto-approves final approval too", () => {
    const [project] = missionPreview(db(), { projectIds: ["auto-render"] }).projects;
    expect(project!.gates.some((gate) => gate.stopsForUser)).toBe(false);
  });

  it("does not read the profile autonomy level: the same project gives the same preview", () => {
    const sqlite = db();
    sqlite.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
    sqlite.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.app', ?, '')").run(JSON.stringify({ level: "autonomous" }));
    const [project] = missionPreview(sqlite, { projectIds: ["manual"] }).projects;
    expect(stopsExceptScriptReview(project!.gates)).toBe(true);
  });

  it("skips a project id that no longer exists", () => {
    expect(missionPreview(db(), { projectIds: ["gone"] }).projects).toEqual([]);
  });
});
