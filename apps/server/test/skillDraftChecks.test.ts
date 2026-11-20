import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { activateSkillVersion, saveSkillDraft, SKILL_EVIDENCE_SOURCES, type SkillEvidence } from "../src/operator/skillVersions.js";
import { findBannedPhrase, findLongQuote } from "../src/operator/skillDraftChecks.js";
import { storePassingBehaviourEval } from "./helpers/behaviour.js";
import { OPERATOR_SKILLS, parseSkillMarkdown, renderSkillMarkdown } from "../src/operator/skills.js";

const roots: string[] = [];
const handles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const registry = new Map([["list_projects", "read"]] as const);

function database() {
  const root = mkdtempSync(join(tmpdir(), "vg-skilldraft-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  handles.push(opened.sqlite);
  return opened.sqlite;
}

function skill(name: string, body: string) {
  return `---
name: ${name}
description: Làm một việc thử nghiệm lặp lại trong app Video Agent
operator: true
area: tu-van-hanh
triggers:
  - thử nghiệm ${name}
tools:
  - list_projects
risk: read
---

# Thử nghiệm

${body}
`;
}

const words = (count: number) => Array.from({ length: count }, (_, i) => `từ${i}`).join(" ");

describe("evidence sources", () => {
  it("accepts all nine sources (four old, five new)", () => {
    const sqlite = database();
    expect(SKILL_EVIDENCE_SOURCES).toHaveLength(9);
    for (const source of SKILL_EVIDENCE_SOURCES) {
      const evidence = { source, runIds: ["run-1"] } as SkillEvidence;
      const saved = saveSkillDraft(sqlite, skill(`nguon-${source.replace(/_/g, "-")}`, "Đọc danh sách dự án."), evidence, registry);
      expect(saved).toMatchObject({ version: 1 });
    }
  });

  it("rejects an unknown source", () => {
    const sqlite = database();
    expect(() => saveSkillDraft(sqlite, skill("nguon-la", "Đọc dự án."), { source: "bogus" as SkillEvidence["source"], runIds: [] }, registry))
      .toThrow(/Nguồn bằng chứng không hợp lệ/);
  });
});

describe("banned phrases", () => {
  it("names the rule and phrase in the rejection", () => {
    const sqlite = database();
    expect(() => saveSkillDraft(sqlite, skill("cam-ngan-sach", "Khi lỗi, tăng ngân sách rồi thử lại."), { source: "pattern", runIds: [] }, registry))
      .toThrow(/raise budgets.*tăng ngân sách/);
  });

  it("finds each of the five rules in English too", () => {
    expect(findBannedPhrase("Please auto-approve the change.")).toEqual({ rule: "approve", phrase: "auto-approve" });
    expect(findBannedPhrase("Turn on paid_fallback when quota runs out.")).toEqual({ rule: "paid_fallback", phrase: "turn on paid_fallback" });
    expect(findBannedPhrase("You may skip the check when busy.")).toEqual({ rule: "skip a check", phrase: "skip the check" });
    expect(findBannedPhrase("Edit the protected project directly.")).toEqual({ rule: "touch the protected project", phrase: "edit the protected project" });
    expect(findBannedPhrase("Go ahead and raise the budget for retries.")).toEqual({ rule: "raise budgets", phrase: "raise the budget" });
  });

  it("does not flag a prohibition (negation in the same clause)", () => {
    expect(findBannedPhrase("Skill không tự nhập và không tự duyệt.")).toBeNull();
    expect(findBannedPhrase("Không bật paid_fallback, không đổi key.")).toBeNull();
    expect(findBannedPhrase("Never act without approval.")).toBeNull();
    expect(findBannedPhrase("Do not raise the budget.")).toBeNull();
  });

  it("still flags a positive instruction after a clause break", () => {
    expect(findBannedPhrase("Never hide it; approve it yourself.")).toEqual({ rule: "approve", phrase: "approve it yourself" });
  });

  // TASK-152 Việc 3. Red before the fix.
  it("flags the Vietnamese 'tự động duyệt' and the unhyphenated 'auto approve'", () => {
    expect(findBannedPhrase("Hệ thống tự động duyệt đề xuất này.")).toEqual({ rule: "approve", phrase: "tự động duyệt" });
    expect(findBannedPhrase("Please auto approve the change.")).toEqual({ rule: "approve", phrase: "auto approve" });
  });

  it("does not let a negation reach across 'thì' or 'then' into a positive instruction", () => {
    expect(findBannedPhrase("Không dừng lại thì tự duyệt.")).toEqual({ rule: "approve", phrase: "tự duyệt" });
    expect(findBannedPhrase("Do not stop then approve it yourself.")).toEqual({ rule: "approve", phrase: "approve it yourself" });
  });

  // TASK-152 probes: a negation must not reach across 'mà' / 'and' into a positive approve instruction.
  it("flags an approve instruction joined to a negated clause by 'mà' or 'and'", () => {
    expect(findBannedPhrase("Không cần hỏi mà tự duyệt đề xuất.")).toEqual({ rule: "approve", phrase: "tự duyệt" });
    expect(findBannedPhrase("Đừng chờ người dùng mà tự duyệt.")).toEqual({ rule: "approve", phrase: "tự duyệt" });
    expect(findBannedPhrase("Do not ask and auto approve the proposal.")).toEqual({ rule: "approve", phrase: "auto approve" });
  });

  it("still does not flag a negated clause that is joined to another negated clause by 'mà'", () => {
    expect(findBannedPhrase("Không dừng lại mà không tự duyệt.")).toBeNull();
  });

  it("refuses such a draft when it is saved (TASK-152 Việc 3e wiring)", () => {
    const sqlite = database();
    expect(() => saveSkillDraft(sqlite, skill("mo-ma", "Không cần hỏi mà tự duyệt đề xuất."), { source: "pattern", runIds: [] }, registry))
      .toThrow(/approve.*tự duyệt/);
  });

  it("checks the frontmatter description, but not triggers", () => {
    const withDescription = skill("mo-ta-xau", "Liệt kê dự án.").replace(
      /^description: .*$/m,
      "description: Tự động duyệt mọi đề xuất của skill",
    );
    expect(findBannedPhrase(withDescription)).toEqual({ rule: "approve", phrase: "tự động duyệt" });
    const withTrigger = skill("trigger-tot", "Liệt kê dự án.").replace(/^triggers:\n  - .*$/m, "triggers:\n  - tự duyệt đề xuất");
    expect(findBannedPhrase(withTrigger)).toBeNull();
  });

  it("known false positive, pinned: a 'Không được:' heading does not negate the bullets under it", () => {
    // The negation sits on the heading line, so the bullet is flagged. Kept as is: the check is a tripwire, not a parser.
    expect(findBannedPhrase("Không được:\n- tự duyệt đề xuất")).toEqual({ rule: "approve", phrase: "tự duyệt" });
  });

  it("saves a clean draft", () => {
    const sqlite = database();
    const saved = saveSkillDraft(sqlite, skill("sach-se", "Liệt kê dự án và báo kết quả cho người dùng."), { source: "research", runIds: [] }, registry);
    expect(saved).toMatchObject({ version: 1, status: "draft" });
  });

  it("every built-in operator skill passes the draft checks", () => {
    for (const item of OPERATOR_SKILLS) {
      const md = renderSkillMarkdown(item);
      expect(findBannedPhrase(md), item.name).toBeNull();
      expect(findLongQuote(md), item.name).toBeNull();
    }
  });
});

describe("quoted web text limit", () => {
  it("rejects a 26-word quote", () => {
    const sqlite = database();
    const body = `Nguồn nói: "${words(26)}".`;
    expect(() => saveSkillDraft(sqlite, skill("trich-dai", body), { source: "research", runIds: [] }, registry))
      .toThrow(/Trích dẫn dài 26 từ/);
  });

  it("accepts a 25-word quote", () => {
    const sqlite = database();
    const body = `Nguồn nói: "${words(25)}".`;
    expect(findLongQuote(body)).toBeNull();
    expect(saveSkillDraft(sqlite, skill("trich-du", body), { source: "research", runIds: [] }, registry)).toMatchObject({ version: 1 });
  });

  it("counts curly quotes and blockquote lines, merging adjacent blockquote lines", () => {
    expect(findLongQuote(`“${words(26)}”`)).toMatchObject({ words: 26 });
    expect(findLongQuote(`> ${words(13)}\n> ${words(13)}`)).toMatchObject({ words: 26 });
  });

  it("counts a quote that is wrapped over two soft-wrapped lines of one paragraph (TASK-152 Việc 3)", () => {
    expect(findLongQuote(`Nguồn nói: "${words(13)}\n${words(13)}".`)).toMatchObject({ words: 26 });
  });

  it("ignores YAML frontmatter and fenced code", () => {
    const frontmatter = `---\ndescription: "${words(30)}"\n---\n\n# Thử`;
    expect(findLongQuote(frontmatter)).toBeNull();
    expect(findLongQuote("```\n" + `"${words(30)}"` + "\n```")).toBeNull();
  });
});

describe("activation is not changed by the draft checks", () => {
  it("activates a version whose stored text has a 26-word quote", () => {
    const sqlite = database();
    const base = renderSkillMarkdown(OPERATOR_SKILLS[0]!);
    const parsed = parseSkillMarkdown(base)!;
    const reg = new Map(parsed.tools.map((tool) => [tool, parsed.risk as "read" | "safe" | "confirm"] as const));
    const md = `${base}\n> ${words(26)}\n`;
    sqlite.prepare("INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, 1, ?, ?, 0, 'draft', ?)")
      .run(parsed.name, md, JSON.stringify({ source: "pattern", runIds: [] }), new Date().toISOString());
    storePassingBehaviourEval(sqlite, parsed.name, 1, { baseline: "builtin", activeVersion: null });
    expect(() => activateSkillVersion(sqlite, parsed.name, 1, reg)).not.toThrow();
  });
});
