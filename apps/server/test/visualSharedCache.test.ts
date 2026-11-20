import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { imageVerdictContext, readImageVerdict, readVisualQueries, reusableImageCheck, writeImageVerdict, writeVisualQuery } from "../src/agents/visualCache.js";

const created = new Date("2026-11-16T00:00:00Z");
const afterDays = (days: number) => new Date(created.getTime() + days * 86_400_000);
const phash = "0123456789abcdef";
const sha256 = "a".repeat(64);

describe("shared visual caches", () => {
  let fixture: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { fixture = createPipelineHarness(); });
  afterEach(() => fixture.close());

  it("scopes verdicts to the workspace and subject and expires them after 90 days", () => {
    const db = fixture.sqlite;
    writeImageVerdict(db, "A", phash, "Berserk | Guts", {
      fit: 0, depicts: "Sai nhân vật", issues: ["wrong_subject"], cropOk: false, model: "fixture", checkedAt: created.toISOString(),
    }, created);
    expect(readImageVerdict(db, "A", phash, "berserk|guts", afterDays(89))?.verdict).toBe("reject");
    expect(readImageVerdict(db, "A", phash, "berserk|griffith", created)).toBeNull();
    expect(readImageVerdict(db, "B", phash, "berserk|guts", created)).toBeNull();
    expect(readImageVerdict(db, "A", phash, "berserk|guts", afterDays(90))).toBeNull();
  });

  it("only reuses a positive judgement in the app for matching image bytes", () => {
    const db = fixture.sqlite;
    const now = new Date();
    const context = imageVerdictContext({ narration: "A river", visualDescription: "river", aspectRatio: "16:9", visionThreshold: 7 });
    writeImageVerdict(db, "A", phash, "river", {
      fit: 9, depicts: "Dòng sông", issues: [], cropOk: true, model: "fixture", checkedAt: now.toISOString(), sha256,
    }, now, context);
    expect(reusableImageCheck(db, "A", { phash, sha256 }, "river", context)?.fit).toBe(9);
    expect(reusableImageCheck(db, "A", { phash, sha256: "b".repeat(64) }, "river", context)).toBeNull();
    expect(reusableImageCheck(db, "A", { phash, sha256 }, "river")).toBeNull();
    expect(readImageVerdict(db, "A", phash, "river")?.visionCheck.fit).toBe(9);
  });

  it("separates context-dependent fit from advisory subject verdicts and invalidates changed policies", () => {
    const db = fixture.sqlite, now = new Date();
    const input = { narration: "Modern Chicago skyline", visualDescription: "Chicago skyline", aspectRatio: "16:9", visionThreshold: 7 };
    const context = imageVerdictContext(input);
    const check = { fit: 9, depicts: "Modern skyline", issues: [], cropOk: true, model: "fixture", checkedAt: now.toISOString(), sha256 };
    writeImageVerdict(db, "A", phash, "skyline", check, now, context);
    for (const changed of [{ narration: "Chicago skyline in 1940" }, { aspectRatio: "9:16" }, { visionThreshold: 9 }, { policyVersion: "future-policy" }]) {
      expect(reusableImageCheck(db, "A", { phash, sha256 }, "skyline", imageVerdictContext({ ...input, ...changed }))).toBeNull();
    }
    expect(reusableImageCheck(db, "A", { phash, sha256 }, "skyline", context)?.fit).toBe(9);
    expect(readImageVerdict(db, "A", phash, "skyline")?.visionCheck.fit).toBe(9);
    // A generic subject that resembles an encoded key cannot collide with the contextual namespace.
    writeImageVerdict(db, "A", phash, `v2:${JSON.stringify(["skyline", context])}`, { ...check, fit: 0 }, now);
    expect(reusableImageCheck(db, "A", { phash, sha256 }, "skyline", context)?.fit).toBe(9);
  });

  it("keeps only public unsigned search hits for seven days", () => {
    const db = fixture.sqlite;
    const hit = { imageUrl: "https://example.com/river.png", sourcePageUrl: "https://example.com/river", title: "River" };
    writeVisualQuery(db, "A", "brave", "River  at noon", [hit, { ...hit, imageUrl: `${hit.imageUrl}?X-Amz-Signature=private` }], created);
    expect(readVisualQueries(db, "A", "river at NOON", "brave", afterDays(6))[0]?.results).toEqual([hit]);
    expect(readVisualQueries(db, "B", "river at noon", "brave", afterDays(6))).toEqual([]);
    expect(readVisualQueries(db, "A", "river at noon", undefined, afterDays(7))).toEqual([]);
  });
});
