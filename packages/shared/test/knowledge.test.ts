import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHANGE_CATEGORIES } from "../src/knowledge/catalog.js";
import { diffJson } from "../src/knowledge/diff.js";
import { parseKnowledgeImport } from "../src/knowledge/import.js";
import { KNOWLEDGE_VALUES, KnowledgeEntrySchema } from "../src/knowledge/schema.js";
import { KNOWLEDGE_SNAPSHOT, snapshotKnowledge } from "../src/knowledge/snapshot.js";
import { knowledgeApplies, knowledgeTime } from "../src/knowledge/time.js";
import { knowledgeRisk } from "../src/knowledge/risk.js";
import { KNOWLEDGE_CONSUMERS } from "../src/knowledge/consumers.js";

const read = (path: string) => readFileSync(new URL(`../../../docs/${path}`, import.meta.url), "utf8");
const serverSrc = fileURLToPath(new URL("../../../apps/server/src/", import.meta.url));

describe("external knowledge", () => {
  it("validates every snapshot and maps kinds and consumers in the catalog", () => {
    for (const entry of KNOWLEDGE_SNAPSHOT) expect(KnowledgeEntrySchema.parse(entry)).toEqual(entry);
    expect(new Set(CHANGE_CATEGORIES.flatMap((row) => row.kinds))).toEqual(new Set(Object.keys(KNOWLEDGE_VALUES)));
    expect(CHANGE_CATEGORIES).toHaveLength(32);
    const docs = read("knowledge/change-catalog.md");
    const guide = read("cursor/TASK-073.md").split("## 2.")[0];
    expect(CHANGE_CATEGORIES.map((row) => row.id).sort()).toEqual([...guide.matchAll(/^\| ([A-G]\d) \|/gm)].map((match) => match[1]).sort());
    for (const row of CHANGE_CATEGORIES) {
      expect(row.manual.trim().length).toBeGreaterThan(0);
      const line = `| ${row.id} | ${row.name} | ${row.kinds.join(", ") || "—"} | ${row.detectors.join(", ")}, manual | ${Object.values(row.reactions).join(" / ")} |`;
      expect(docs).toContain(line);
    }
    for (const id of Object.values(KNOWLEDGE_CONSUMERS).flat()) {
      if (!id.endsWith("*")) expect(snapshotKnowledge(id), id).toBeDefined();
    }
  });

  it("resolves literal server knowledge reads to declared snapshot entries", () => {
    const calls = [];
    for (const path of readdirSync(serverSrc, { recursive: true, encoding: "utf8" })) {
      if (!path.endsWith(".ts")) continue;
      const source = readFileSync(join(serverSrc, path), "utf8");
      for (const [, id] of source.matchAll(/\bknowledge\??\.(?:get|value)(?:<[^\n]+?>)?\(\s*["']([^"']+)["']/g)) {
        calls.push(id);
        expect(snapshotKnowledge(id), `${path}: ${id}`).toBeDefined();
        expect(Object.values(KNOWLEDGE_CONSUMERS).flat(), id).toContain(id);
      }
    }
    expect(calls).toContain("limit.youtube.shorts_max_sec");
  });

  it("uses inclusive start, exclusive end, and the newest evidence day", () => {
    const base = KNOWLEDGE_SNAPSHOT[0]!;
    const entry = { ...base, volatility: "weekly" as const, validFrom: "2026-11-12", validUntil: "2026-11-18",
      evidence: [base.evidence[0]!, { ...base.evidence[0]!, checkedAt: "2026-11-11" }] };
    expect(knowledgeApplies(entry, new Date("2026-11-11"))).toBe(false);
    expect(knowledgeApplies(entry, new Date("2026-11-12"))).toBe(true);
    expect(knowledgeApplies(entry, new Date("2026-11-18"))).toBe(false);
    expect(knowledgeTime(entry, new Date("2026-11-18"))).toEqual({ freshness: "fresh", reviewAfter: "2026-11-18" });
    expect(knowledgeTime(entry, new Date("2026-11-19")).freshness).toBe("due");
    expect(knowledgeTime(entry, new Date("2026-11-26")).freshness).toBe("stale");
  });

  it("creates valid patch paths for nested fields, arrays and type changes", () => {
    expect(diffJson({ "a/b": { "~": [1, 2] }, b: "x" }, { "a/b": { "~": [3] }, b: { n: 1 } })).toEqual([
      { op: "replace", path: "/a~1b/~0/0", value: 3 },
      { op: "remove", path: "/a~1b/~0/1" },
      { op: "replace", path: "/b", value: { n: 1 } },
    ]);
    expect(diffJson([0], [0, 1])).toEqual([{ op: "add", path: "/-", value: 1 }]);
  });

  it("imports examples from all three research files and converts the legacy kind", () => {
    const monetization = JSON.parse(read("research/monetization/knowledge.json"));
    const legacy = monetization.find((row: { id: string }) => row.id === "limit.youtube.shorts_max_sec");
    const converted = parseKnowledgeImport(legacy);
    expect(converted.success && converted.data.kind).toBe("platform_capability");
    expect(converted.success && converted.data.value).toMatchObject({ value: 180, api: false });
    for (const row of [
      monetization[0], JSON.parse(read("research/markets/markets.json"))[0],
      ...JSON.parse(read("research/change-signals/knowledge.json")).slice(0, 5),
    ]) expect(parseKnowledgeImport(row).success).toBe(true);
    expect(parseKnowledgeImport({ id: "bad" }).success).toBe(false);
  });

  it("classifies limits, source-only edits and measured facts", () => {
    const entry = snapshotKnowledge("limit.youtube.shorts_max_sec")!;
    expect(knowledgeRisk(null, entry, diffJson(null, entry))).toBe("high");
    expect(knowledgeRisk(entry, { ...entry, notes: "Thử" }, [{ op: "add", path: "/notes", value: "Thử" }])).toBe("low");
    const measured = { ...entry, evidence: [{ ...entry.evidence[0]!, type: "measured" as const }] };
    expect(knowledgeRisk(entry, measured, [{ op: "replace", path: "/evidence/0/type", value: "measured" }])).toBe("high");
  });
});
