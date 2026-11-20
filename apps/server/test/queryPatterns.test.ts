import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { queryHints, queryShapes, recordQueryOutcome, topicTagFor } from "../src/learning/queryPatterns.js";

describe("TASK-148d visual query patterns", () => {
  let fixture: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { fixture = createPipelineHarness(); });
  afterEach(() => fixture.close());

  it("detects coarse query shapes without an LLM", () => {
    expect(queryShapes("Ho Chi Minh City street 1975")).toEqual(expect.arrayContaining(["proper_noun", "year"]));
    expect(queryShapes("river photo")).toEqual(expect.arrayContaining(["generic_word", "short"]));
    expect(queryShapes("sông Hương")).toContain("non_latin");
    expect(queryShapes("quiet forest path at dawn")).toEqual(["plain"]);
  });

  it("normalises topic tags and falls back to general", () => {
    expect(topicTagFor("  Lịch Sử  Việt ")).toBe("lịch sử việt");
    expect(topicTagFor("")).toBe("general");
    expect(topicTagFor(null)).toBe("general");
  });

  it("records accept and reject counts per shape and returns accepted examples only", () => {
    const db = fixture.sqlite;
    recordQueryOutcome(db, { workspaceId: "W", topic: "History", query: "Hue citadel 1960", accepted: true });
    recordQueryOutcome(db, { workspaceId: "W", topic: "history", query: "Hue citadel 1960", accepted: true });
    recordQueryOutcome(db, { workspaceId: "W", topic: "history", query: "river photo", accepted: false });
    expect(queryHints(db, "W", "HISTORY")).toEqual(["Hue citadel 1960"]);
    expect(queryHints(db, "W", "cooking")).toEqual([]);
    expect(queryHints(db, "OTHER", "history")).toEqual([]);
  });

  it("caps hints at five and never stores URLs or no-workspace rows", () => {
    const db = fixture.sqlite;
    for (let i = 0; i < 7; i += 1) recordQueryOutcome(db, { workspaceId: "W", topic: "t", query: `place ${i} 2001`, accepted: true });
    recordQueryOutcome(db, { workspaceId: "W", topic: "t", query: "see https://example.com/x 2001", accepted: true });
    recordQueryOutcome(db, { workspaceId: null, topic: "t", query: "ignored 2001", accepted: true });
    const hints = queryHints(db, "W", "t");
    expect(hints).toHaveLength(5);
    expect(hints.some((hint) => hint.includes("http"))).toBe(false);
    expect(queryHints(db, null, "t")).toEqual([]);
  });

  it("ranks by accepted count per query, not inflated by how many shapes the query has", () => {
    const db = fixture.sqlite;
    // "river photo Hue 1960" has 3 shapes (proper_noun, year, generic_word); accepted once.
    recordQueryOutcome(db, { workspaceId: "W", topic: "rank", query: "river photo Hue 1960", accepted: true });
    // "quiet forest path at dawn" has 1 shape (plain); accepted twice, so it must rank first.
    recordQueryOutcome(db, { workspaceId: "W", topic: "rank", query: "quiet forest path at dawn", accepted: true });
    recordQueryOutcome(db, { workspaceId: "W", topic: "rank", query: "quiet forest path at dawn", accepted: true });
    expect(queryHints(db, "W", "rank")).toEqual(["quiet forest path at dawn", "river photo Hue 1960"]);
  });

  it("keeps hints per channel: one channel never sees another channel's accepted queries", () => {
    const db = fixture.sqlite;
    recordQueryOutcome(db, { workspaceId: "W", channel: "P1", topic: "rank", query: "river photo Hue 1960", accepted: true });
    recordQueryOutcome(db, { workspaceId: "W", channel: "P2", topic: "rank", query: "market stall Saigon", accepted: true });
    expect(queryHints(db, "W", "rank", "P1")).toEqual(["river photo Hue 1960"]);
    expect(queryHints(db, "W", "rank", "P2")).toEqual(["market stall Saigon"]);
    expect(queryHints(db, "W", "rank", "")).toEqual([]);
  });
});
