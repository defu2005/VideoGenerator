import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Timeline } from "@vg/shared";
import { rememberTimelineSnapshot, undoTimelineSnapshot } from "../src/timeline/snapshots.js";

const timeline = { revision: 1, scenes: [] } as unknown as Timeline;

describe("timeline snapshots", () => {
  it("keeps the newest 30 copies", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE timeline_snapshots (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      revision integer NOT NULL,
      snapshot text NOT NULL,
      source text NOT NULL,
      summary text NOT NULL,
      created_at text NOT NULL
    )`);
    for (let index = 0; index < 31; index += 1) {
      rememberTimelineSnapshot(sqlite, "p1", { ...timeline, revision: index }, "manual", `bản ${index}`);
    }
    const row = sqlite.prepare("SELECT COUNT(*) AS count FROM timeline_snapshots").get() as { count: number };
    expect(row.count).toBe(30);
  });

  it("keeps a voice whose project file still exists and clears one that is gone", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE timeline_snapshots (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      revision integer NOT NULL,
      snapshot text NOT NULL,
      source text NOT NULL,
      summary text NOT NULL,
      created_at text NOT NULL
    )`);
    const stored = {
      revision: 2,
      scenes: [
        { sceneId: "keep", voice: { path: "voices/keep.wav" } },
        { sceneId: "gone", voice: { path: "voices/gone.wav" } },
      ],
    } as unknown as Timeline;
    rememberTimelineSnapshot(sqlite, "p1", stored, "manual", "trước");
    const restored = undoTimelineSnapshot(sqlite, "p1", (path) => path === "voices/keep.wav");
    expect(restored?.timeline.scenes[0]?.voice?.path).toBe("voices/keep.wav");
    expect(restored?.timeline.scenes[1]?.voice).toBeNull();
  });
});
