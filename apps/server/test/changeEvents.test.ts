import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliSignal, snapshotKnowledge, watchHash } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { ChangeInbox, assertPublishAllowed } from "../src/knowledge/changeInbox.js";
import { assertReadOnlyNpm, dependencyCommands, runDependencySweep, runDocumentWatchFull } from "../src/knowledge/documentWatch.js";
import { OPERATOR_SKILLS } from "../src/operator/skills.js";

let root: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let inbox: ChangeInbox;
const now = () => new Date("2026-11-11T05:00:00.000Z");
const page = "Chính sách độ dài video ngắn giữ nguyên câu này để đủ dài cho bộ kiểm.";
const url = "https://example.com/policy";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vg-change-"));
  const opened = openDatabase(join(root, "test.db"));
  sqlite = opened.sqlite;
  migrateDatabase(opened.db, undefined, sqlite);
  inbox = new ChangeInbox(sqlite, now);
});
afterEach(() => {
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

describe("change inbox", () => {
  it("turns repeated HTTP 410 notes into one change event", () => {
    for (let index = 0; index < 31; index += 1) {
      inbox.observe({ provider: "collectionapi.metmuseum.org", endpoint: "/public/collection/v1/search", status: 410, category: "D2" });
    }
    const events = inbox.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toContain("410");
  });

  it("merges a repeated fingerprint and holds only the named account", () => {
    inbox.putSetting("change.policy", JSON.stringify({ E1: { critical: ["R1"] } }));
    const first = inbox.record({
      category: "E1", detector: "D2", subject: { type: "account", id: "acc-yt" },
      summary: "Token YouTube bị thu hồi", evidence: {}, severity: "critical", fingerprint: "auth:yt",
      consumers: ["YouTubePublisher.publish"],
    });
    const again = inbox.record({
      category: "E1", detector: "D2", subject: { type: "account", id: "acc-yt" },
      summary: "Token YouTube bị thu hồi", evidence: {}, severity: "critical", fingerprint: "auth:yt",
    });
    expect(again.id).toBe(first.id);
    expect(again.seenCount).toBe(2);
    expect(again.reaction.levels).toContain("R4");
    expect(inbox.list()).toHaveLength(1);
    expect(() => assertPublishAllowed(sqlite, { id: "acc-yt", platform: "youtube" })).toThrow(/thu hồi/);
    expect(() => assertPublishAllowed(sqlite, { id: "acc-yt-2", platform: "youtube" })).not.toThrow();
    expect(() => assertPublishAllowed(sqlite, { id: "acc-tt", platform: "tiktok" })).not.toThrow();
    inbox.resolve(first.id);
    expect(() => assertPublishAllowed(sqlite, { id: "acc-yt", platform: "youtube" })).not.toThrow();
  });

  it("continues one hold and leaves another event open", () => {
    const held = inbox.record({
      category: "B1", detector: "D7", subject: { type: "knowledge", id: "limit.youtube.shorts_max_sec" },
      summary: "Giữ nơi dùng độ dài Shorts", evidence: {}, severity: "critical", fingerprint: "hold:shorts",
    });
    inbox.continueEvent(held.id);
    expect(inbox.activeHoldViews().some((hold) => hold.active)).toBe(false);
    expect(inbox.list({ status: "acknowledged" })).toHaveLength(1);
  });

  it("watches a page without calling a model for noise, a shell, ECO or an empty budget", async () => {
    const baseline = `${page} Cập nhật 2026-01-01. Lượt xem 1,000.`;
    inbox.putSetting("change.watches", JSON.stringify({
      [url]: { hash: watchHash(baseline), canonical: null, items: [], checkedAt: now().toISOString() },
    }));
    const llm = vi.fn();
    const noise = await runDocumentWatchFull(inbox, {
      url, kind: "policy_page", category: "B1", subjectId: "limit.youtube.shorts_max_sec",
      fetch: async () => ({ status: 200, url, text: `${page} Cập nhật 2026-01-02. Lượt xem 9,876.` }), llm, eco: false,
    });
    expect(noise.class).toBe("unchanged");
    expect(llm).not.toHaveBeenCalled();
    expect(inbox.list()).toHaveLength(0);

    const missing = await runDocumentWatchFull(inbox, {
      url, kind: "policy_page", category: "B1", subjectId: "limit.youtube.shorts_max_sec",
      fetch: async () => ({ status: 404, url, text: page }), llm,
    });
    expect(missing.class).toBe("g1");
    const shell = await runDocumentWatchFull(inbox, {
      url: "https://example.com/shell", kind: "policy_page", category: "B1", subjectId: "limit.youtube.shorts_max_sec",
      fetch: async () => ({ status: 200, url: "https://example.com/shell", text: "<div id=app>" }), llm,
    });
    expect(shell.class).toBe("g2");

    inbox.putSetting("change.llmBudget", "0");
    const capped = await runDocumentWatchFull(inbox, {
      url: "https://example.com/fresh", kind: "policy_page", category: "B1", subjectId: "limit.youtube.shorts_max_sec",
      fetch: async () => ({ status: 200, url: "https://example.com/fresh", text: page }), llm,
    });
    expect(capped.llm).toBe("skipped");
    const eco = await runDocumentWatchFull(inbox, {
      url: "https://example.com/eco", kind: "policy_page", category: "B1", subjectId: "limit.youtube.shorts_max_sec", eco: true,
      fetch: async () => ({ status: 200, url: "https://example.com/eco", text: page }), llm,
    });
    expect(eco.llm).toBe("skipped");
    expect(llm).not.toHaveBeenCalled();
  });

  it("proposes only when the quote is on the page", async () => {
    const limit = snapshotKnowledge("limit.youtube.shorts_max_sec")!;
    const proposed = { ...limit, value: { ...(limit.value as object), value: 120 } };
    const quote = "giữ nguyên câu này";
    const reading = await runDocumentWatchFull(inbox, {
      url, kind: "policy_page", category: "B1", subjectId: limit.id,
      fetch: async () => ({ status: 200, url, text: page }),
      llm: async () => ({ effect: "change", quote, summary: "Độ dài đổi", proposal: proposed }),
    });
    expect(reading.reading).toBe("proposed");
    expect(inbox.list()[0]?.reaction.proposalId).toBeTruthy();

    const low = await runDocumentWatchFull(inbox, {
      url: "https://example.com/other", kind: "policy_page", category: "B1", subjectId: limit.id,
      fetch: async () => ({ status: 200, url: "https://example.com/other", text: page }),
      llm: async () => ({ effect: "change", quote: "câu không có trên trang", summary: "Không khớp" }),
    });
    expect(low.reading).toBe("low");
    expect(inbox.list().find((event) => event.fingerprint.startsWith("d1:low:"))?.reaction.proposalId).toBeUndefined();
  });

  it("emits a runtime signal after the threshold and ignores one 500", () => {
    expect(inbox.observe({ provider: "pexels", endpoint: "/search", status: 500 }).emitted).toBe(false);
    expect(inbox.observe({ provider: "pexels", endpoint: "/search", status: 429 }).emitted).toBe(false);
    expect(inbox.observe({ provider: "pexels", endpoint: "/search", status: 429 }).emitted).toBe(false);
    expect(inbox.observe({ provider: "pexels", endpoint: "/search", status: 429 }).emitted).toBe(true);
    expect(inbox.list()).toHaveLength(1);
    expect(inbox.observe({ provider: "openai", endpoint: "/v1/models", status: 200, headers: { sunset: "soon" }, category: "D1" }).emitted).toBe(true);
    expect(inbox.observeCli(cliSignal({ provider: "edge-tts", version: "1", seenVersions: [], seenMessages: [] })).emitted).toBe(false);
    expect(inbox.observeCli(cliSignal({ provider: "edge-tts", version: "2", seenVersions: ["1"], seenMessages: [] })).emitted).toBe(true);
  });

  it("opens a high event for a stale risky entry and for a dependency advisory", () => {
    const opened = inbox.sweepStale([
      { id: "law.youtube.rules", kind: "law", freshness: "stale" },
      { id: "guideline.youtube", kind: "guideline_pack", freshness: "stale" },
      { id: "law.youtube.due", kind: "law", freshness: "due" },
    ]);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.severity).toBe("high");
    expect(runDependencySweep(inbox, { leftpad: { deprecated: "use pad" } }, { vulnerabilities: { lodash: { severity: "high" }, tiny: { severity: "low" } } })).toBe(2);
    expect(dependencyCommands()).toEqual({ outdated: "npm outdated --json", audit: "npm audit --json" });
    expect(() => assertReadOnlyNpm("npm install leftpad")).toThrow(/chỉ đọc/i);
  });

  it("files a manual report and investigates when it names a knowledge entry", () => {
    const event = inbox.report({ category: "B1", summary: "Đối chiếu limit.youtube.shorts_max_sec", url: "https://example.com/policy" });
    expect(event.detector).toBe("D7");
    expect(event.reaction.levels).toContain("R5");
    expect(event.subject).toEqual({ type: "knowledge", id: "limit.youtube.shorts_max_sec" });
    const plain = inbox.report({ category: "C3", summary: "Lịch mùa không gắn một mục" });
    expect(plain.reaction.levels).not.toContain("R5");
  });

  it("keeps the operator skills from accepting knowledge or lifting a critical hold", () => {
    for (const name of ["knowledge_refresh", "change_investigation", "research_brief"]) {
      const skill = OPERATOR_SKILLS.find((item) => item.name === name);
      expect(skill?.tools.length).toBeGreaterThan(0);
      expect(skill?.tools).not.toContain("resolve_change_event");
      expect(skill?.tools.join(" ")).not.toContain("accept");
    }
  });
});
