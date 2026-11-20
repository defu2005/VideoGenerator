import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { AppError } from "../src/lib/errors.js";
import { autoEligibility, autoShadowReasons, checkAutoActivation, readOnlyReasons } from "../src/operator/autoActivation.js";
import { OPERATOR_SKILLS } from "../src/operator/skills.js";
import { activateSkillVersion, listSkillVersions, markShadowVersion, saveSkillDraft, shadowVersionFor } from "../src/operator/skillVersions.js";
import { storePassingBehaviourEval } from "./helpers/behaviour.js";

const roots: string[] = [];
const handles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const registry = new Map([["list_projects", "read"], ["list_tasks", "read"], ["delete_project", "confirm"]] as const);
const now = new Date();

function database(): Database.Database {
  const root = mkdtempSync(join(tmpdir(), "vg-autoact-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  handles.push(opened.sqlite);
  return opened.sqlite;
}

function skillMarkdown(name: string, body: string, tools = ["list_projects"], risk = "read") {
  return `---
name: ${name}
description: Kiểm tra danh sách dự án ${name}
operator: true
area: tu-van-hanh
triggers:
  - thử nghiệm ${name}
tools:
${tools.map((tool) => `  - ${tool}`).join("\n")}
risk: ${risk}
---

${body}
`;
}

function insertRuns(db: Database.Database, name: string, version: number, count: number) {
  const insert = db.prepare(
    `INSERT INTO operator_skill_shadow_runs
      (id, skill_name, shadow_version, active_version, run_id, query, rank, planned, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < count; index++) {
    insert.run(randomUUID(), name, version, 1, `run-${index}`, "lỗi list_projects", 1, "[]", now.toISOString());
  }
}

/** The kind of baseline a built-in name has (builtin) or a new name has (none), as runBehaviourEval records it. */
const baselineKindFor = (name: string) => (OPERATOR_SKILLS.some((skill) => skill.name === name) ? "builtin" as const : "none" as const);

/**
 * Builds: v1 active (passed eval), v2 a candidate draft made the shadow version, with `runs` shadow rows.
 * Options change the candidate only: its body, declared tools, risk, eval result, or no eval at all.
 */
function withShadow(name: string, options: {
  runs?: number; evalActiveVersion?: number | null; body?: string; tools?: string[]; noEval?: boolean; evalPassed?: boolean;
} = {}) {
  const db = database();
  const base = saveSkillDraft(db, skillMarkdown(name, "Liệt kê dự án."), { source: "pattern", runIds: [] }, registry)!;
  storePassingBehaviourEval(db, name, base.version, { baseline: baselineKindFor(name), activeVersion: null });
  activateSkillVersion(db, name, base.version, registry);
  const candidate = saveSkillDraft(
    db,
    skillMarkdown(name, options.body ?? "Liệt kê dự án, không ghi gì.", options.tools),
    { source: "pattern", runIds: [] },
    registry,
  )!;
  const activeVersion = options.evalActiveVersion === undefined ? base.version : options.evalActiveVersion;
  if (!options.noEval) {
    storePassingBehaviourEval(db, name, candidate.version, { baseline: "active", activeVersion, passed: options.evalPassed ?? true });
  }
  markShadowVersion(db, name, candidate.version);
  insertRuns(db, name, candidate.version, options.runs ?? 5);
  return { db, version: candidate.version };
}

/** Runs fn and returns the error it throws, so a test can check the status and code, not only the text. */
function thrownBy(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError, nothing was thrown");
}

describe("auto activation of a shadow version (TASK-074b-4)", () => {
  it("activates the shadow version once it has 5 runs, a passed eval and a baseline", () => {
    const { db, version } = withShadow("auto-read-skill");
    const result = checkAutoActivation(db, "auto-read-skill", { now, registry, autoEnabled: true });
    expect(result).toMatchObject({ activated: true, reasons: [], version });
    expect(result.markdown).toContain("không ghi gì");
    const statuses = Object.fromEntries(listSkillVersions(db).map((item) => [item.version, item.status]));
    expect(statuses).toEqual({ 1: "archived", 2: "active" });
  });

  it("does nothing while the setting is off, and keeps the shadow", () => {
    const { db } = withShadow("auto-off-skill");
    expect(checkAutoActivation(db, "auto-off-skill", { now, registry, autoEnabled: false }))
      .toEqual({ activated: false, reasons: [], markdown: null, version: null });
    expect(shadowVersionFor(db, "auto-off-skill")).not.toBeNull();
  });

  it("is a silent no-op on a second call after activation", () => {
    const { db } = withShadow("auto-twice-skill");
    checkAutoActivation(db, "auto-twice-skill", { now, registry, autoEnabled: true });
    expect(checkAutoActivation(db, "auto-twice-skill", { now, registry, autoEnabled: true }))
      .toEqual({ activated: false, reasons: [], markdown: null, version: null });
  });

  it("rolls the flip back when activation fails after it (TASK-152 6c): shadow stays, active stays", () => {
    const { db, version } = withShadow("auto-rollback-skill");
    // Fault injection: the activating UPDATE aborts after the shadow->draft flip has already run.
    db.exec("CREATE TRIGGER fail_activate BEFORE UPDATE OF status ON operator_skill_versions WHEN NEW.status = 'active' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    expect(() => checkAutoActivation(db, "auto-rollback-skill", { now, registry, autoEnabled: true })).toThrow(/injected/);
    const statuses = Object.fromEntries(listSkillVersions(db).map((item) => [item.version, item.status]));
    expect(statuses[version]).toBe("shadow");
    expect(shadowVersionFor(db, "auto-rollback-skill")?.version).toBe(version);
    expect(statuses[1]).toBe("active");
  });

  it("flip-then-refuse: a candidate whose markdown names another skill is refused and stays shadow (TASK-074b-4 item 5)", () => {
    const { db, version } = withShadow("auto-name-skill");
    db.prepare("UPDATE operator_skill_versions SET markdown = ? WHERE name = ? AND version = ?")
      .run(skillMarkdown("other-name", "Liệt kê dự án, không ghi gì."), "auto-name-skill", version);
    const result = checkAutoActivation(db, "auto-name-skill", { now, registry, autoEnabled: true });
    expect(result).toMatchObject({ activated: false, version: null });
    expect(result.reasons).toContain("Tên skill không khớp.");
    const statuses = Object.fromEntries(listSkillVersions(db).map((item) => [item.version, item.status]));
    expect(statuses[version]).toBe("shadow");
    expect(statuses[1]).toBe("active");
  });

  it("refuses with fewer than 5 runs and keeps the shadow", () => {
    const { db } = withShadow("auto-few-skill", { runs: 3 });
    const result = checkAutoActivation(db, "auto-few-skill", { now, registry, autoEnabled: true });
    expect(result.activated).toBe(false);
    expect(result.reasons.join(" ")).toContain("chưa đủ 5 lượt");
    expect(shadowVersionFor(db, "auto-few-skill")).not.toBeNull();
  });

  it("refuses a stale behaviour eval with the exact stale reason, and leaves the active version alone", () => {
    const { db } = withShadow("auto-stale-skill", { evalActiveVersion: 9 });
    const result = checkAutoActivation(db, "auto-stale-skill", { now, registry, autoEnabled: true });
    expect(result.activated).toBe(false);
    expect(result.reasons).toEqual(["eval hành vi: kết quả eval cũ (bản đang dùng đã đổi)"]);
    expect(shadowVersionFor(db, "auto-stale-skill")).toMatchObject({ version: 2 });
    expect(listSkillVersions(db).find((item) => item.version === 1)?.status).toBe("active");
  });

  it("refuses a candidate with no stored behaviour eval", () => {
    const { db } = withShadow("auto-noeval-skill", { noEval: true });
    const result = checkAutoActivation(db, "auto-noeval-skill", { now, registry, autoEnabled: true });
    expect(result.reasons).toEqual(["eval hành vi: chưa chạy eval hành vi"]);
    expect(shadowVersionFor(db, "auto-noeval-skill")).not.toBeNull();
  });

  it("refuses a candidate whose behaviour eval did not pass", () => {
    const { db } = withShadow("auto-failed-skill", { evalPassed: false });
    const result = checkAutoActivation(db, "auto-failed-skill", { now, registry, autoEnabled: true });
    expect(result.reasons).toEqual(["eval hành vi: chưa qua eval hành vi"]);
  });

  it("refuses a candidate that declares a tool the baseline does not (no-worse subset check)", () => {
    const { db } = withShadow("auto-tools-skill", { tools: ["list_projects", "list_tasks"] });
    const result = checkAutoActivation(db, "auto-tools-skill", { now, registry, autoEnabled: true });
    expect(result.reasons).toEqual(["khai báo nhiều công cụ hơn bản nền"]);
  });

  it("refuses a candidate whose text names a mutating tool, even with an eval", () => {
    const { db } = withShadow("auto-mutate-skill", { body: "Hãy dùng delete_project để dọn." });
    const result = checkAutoActivation(db, "auto-mutate-skill", { now, registry, autoEnabled: true });
    expect(result.reasons).toEqual(["skill nhắc tới công cụ có quyền ghi"]);
    expect(shadowVersionFor(db, "auto-mutate-skill")).not.toBeNull();
  });

  it("never auto-activates a built-in skill", () => {
    const builtin = OPERATOR_SKILLS.find((skill) => !skill.research)!.name;
    const { db, version } = withShadow(builtin);
    expect(autoEligibility(db, builtin, version, registry, now)).toContain("skill có sẵn không tự kích hoạt");
    expect(checkAutoActivation(db, builtin, { now, registry, autoEnabled: true }).activated).toBe(false);
  });

  it("activates a research built-in with no DB version: the built-in is the baseline, and a subset of its tools passes", () => {
    const researchRegistry = new Map<string, "read" | "confirm">([...registry, ["web_search", "read"], ["run_research", "confirm"]]);
    const db = database();
    const name = "research-market";
    // A research skill must keep its kind/question/outputKinds, and must not name run_research (mutating), so it is written by hand.
    const markdown = `---
name: ${name}
description: Tìm thông tin thị trường từ trang chính thức.
operator: true
area: tu-cai-tien
kind: research
question: Thị trường này có ngôn ngữ, nền tảng và quy định nào?
outputKinds: ["market"]
sources: []
maxPages: 15
triggers:
  - nghiên cứu thị trường
antiTriggers:
  - xoá
tools:
  - web_search
risk: read
---

## Ngan
- Tìm trang chính thức và trích câu kiểm được.
`;
    const draft = saveSkillDraft(db, markdown, { source: "pattern", runIds: [] }, researchRegistry)!;
    storePassingBehaviourEval(db, name, draft.version, { baseline: "builtin", activeVersion: null });
    markShadowVersion(db, name, draft.version);
    insertRuns(db, name, draft.version, 5);
    const result = checkAutoActivation(db, name, { now, registry: researchRegistry, autoEnabled: true });
    expect(result).toMatchObject({ activated: true, reasons: [], version: draft.version });
    const statuses = Object.fromEntries(listSkillVersions(db).map((item) => [item.version, item.status]));
    expect(statuses).toEqual({ [draft.version]: "active" });
  });

  it("activates the renamed research-provider-terms skill (no longer shadowed by the non-research research-provider)", () => {
    const researchRegistry = new Map<string, "read" | "confirm">([...registry, ["web_search", "read"], ["run_research", "confirm"]]);
    const db = database();
    const name = "research-provider-terms";
    const markdown = `---
name: ${name}
description: Tìm điều khoản và giá của nhà cung cấp từ trang chính thức.
operator: true
area: tu-cai-tien
kind: research
question: Nhà cung cấp có giá và điều khoản nào?
outputKinds: ["provider_terms", "api_contract"]
sources: []
maxPages: 15
triggers:
  - nghiên cứu điều khoản nhà cung cấp
antiTriggers:
  - xoá
tools:
  - web_search
risk: read
---

## Ngan
- Tìm trang chính thức và trích câu kiểm được.
`;
    const draft = saveSkillDraft(db, markdown, { source: "pattern", runIds: [] }, researchRegistry)!;
    storePassingBehaviourEval(db, name, draft.version, { baseline: "builtin", activeVersion: null });
    markShadowVersion(db, name, draft.version);
    insertRuns(db, name, draft.version, 5);
    const result = checkAutoActivation(db, name, { now, registry: researchRegistry, autoEnabled: true });
    expect(result).toMatchObject({ activated: true, reasons: [], version: draft.version });
  });

  it("never auto-shadows a draft the user edited", () => {
    const db = database();
    const edit = saveSkillDraft(db, skillMarkdown("auto-edit-skill", "Bản người dùng sửa."), { source: "user_edit", runIds: [] }, registry)!;
    expect(autoShadowReasons(db, "auto-edit-skill", edit.version, registry).join(" ")).toContain("người dùng tự sửa");
  });

  it("refuses a user_edit shadow with no eval: the exemption does not reach the auto path", () => {
    const db = database();
    const name = "auto-edit-shadow-skill";
    const base = saveSkillDraft(db, skillMarkdown(name, "Liệt kê dự án."), { source: "pattern", runIds: [] }, registry)!;
    storePassingBehaviourEval(db, name, base.version, { baseline: "none", activeVersion: null });
    activateSkillVersion(db, name, base.version, registry);
    const edit = saveSkillDraft(db, skillMarkdown(name, "Bản người dùng sửa, không ghi gì."), { source: "user_edit", runIds: [] }, registry)!;
    markShadowVersion(db, name, edit.version);
    insertRuns(db, name, edit.version, 5);
    const result = checkAutoActivation(db, name, { now, registry, autoEnabled: true });
    expect(result.activated).toBe(false);
    expect(result.reasons).toEqual(["eval hành vi: chưa chạy eval hành vi"]);
    expect(shadowVersionFor(db, name)).toMatchObject({ version: edit.version });
  });

  it("refuses a candidate with no active version as its baseline (no-baseline reason only)", () => {
    const db = database();
    const name = "auto-nobase-skill";
    const draft = saveSkillDraft(db, skillMarkdown(name, "Liệt kê dự án."), { source: "pattern", runIds: [] }, registry)!;
    storePassingBehaviourEval(db, name, draft.version, { baseline: "none", activeVersion: null });
    expect(autoShadowReasons(db, name, draft.version, registry)).toEqual(["chưa có bản nền để so sánh"]);
  });

  it("reads declared tools and the text for mutating tools", () => {
    expect(readOnlyReasons(skillMarkdown("read-check-skill", "ok", ["delete_project"], "confirm"), {}, registry))
      .toContain("skill khai báo công cụ không chỉ đọc");
    expect(readOnlyReasons(skillMarkdown("read-check-skill", "Hãy dùng delete_project để dọn."), {}, registry))
      .toContain("skill nhắc tới công cụ có quyền ghi");
    expect(readOnlyReasons(skillMarkdown("read-check-skill", "Liệt kê dự án."), {}, registry)).toEqual([]);
  });

  it("imports no executor, runner, fleet or operator service", () => {
    const source = readFileSync(new URL("../src/operator/autoActivation.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^import /.test(line) && !/^import type /.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).not.toMatch(/fleet|service|executor|runner|modelRuntime|child_process/);
  });
});

describe("user path behaviour gate (TASK-074b-4)", () => {
  it("refuses a pattern draft with no eval, with code SKILL_BEHAVIOUR_NOT_PASSED", () => {
    const db = database();
    const draft = saveSkillDraft(db, skillMarkdown("gate-pattern-skill", "Liệt kê dự án."), { source: "pattern", runIds: [] }, registry)!;
    const error = thrownBy(() => activateSkillVersion(db, draft.name, draft.version, registry));
    expect(error).toMatchObject({ statusCode: 409, code: "SKILL_BEHAVIOUR_NOT_PASSED" });
    expect(error.message).toContain("chưa chạy eval hành vi");
  });

  it("lets a user_edit draft activate with no eval (the exemption is on the user path only)", () => {
    const db = database();
    const edit = saveSkillDraft(db, skillMarkdown("gate-edit-skill", "Liệt kê dự án."), { source: "user_edit", runIds: [] }, registry)!;
    expect(() => activateSkillVersion(db, edit.name, edit.version, registry)).not.toThrow();
  });

  it("refuses a stored eval taken against a different baseline kind (built-in name, stored as none)", () => {
    const db = database();
    const builtin = OPERATOR_SKILLS.find((skill) => !skill.research)!.name;
    const draft = saveSkillDraft(db, skillMarkdown(builtin, "Liệt kê dự án."), { source: "pattern", runIds: [] }, registry)!;
    storePassingBehaviourEval(db, builtin, draft.version, { baseline: "none", activeVersion: null });
    const error = thrownBy(() => activateSkillVersion(db, builtin, draft.version, registry));
    expect(error).toMatchObject({ code: "SKILL_BEHAVIOUR_NOT_PASSED" });
    expect(error.message).toContain("kết quả eval cũ");
  });

  it("restoring an archived version is not blocked by the eval gate (rollback)", () => {
    const db = database();
    const name = "gate-restore-skill";
    const first = saveSkillDraft(db, skillMarkdown(name, "Liệt kê dự án."), { source: "user_edit", runIds: [] }, registry)!;
    activateSkillVersion(db, name, first.version, registry);
    const second = saveSkillDraft(db, skillMarkdown(name, "Liệt kê dự án, không ghi gì."), { source: "pattern", runIds: [] }, registry)!;
    storePassingBehaviourEval(db, name, second.version, { baseline: "active", activeVersion: first.version });
    activateSkillVersion(db, name, second.version, registry);
    const statusOf = (version: number) => listSkillVersions(db).find((item) => item.version === version)?.status;
    expect(statusOf(first.version)).toBe("archived");
    // No eval is stored for the archived version: restoring it works, because the gate runs only for drafts.
    expect(() => activateSkillVersion(db, name, first.version, registry)).not.toThrow();
    expect(statusOf(first.version)).toBe("active");
  });
});
