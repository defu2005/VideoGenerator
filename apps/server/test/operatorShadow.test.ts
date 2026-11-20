import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import type { AssistantService } from "../src/assistant/service.js";
import { runTool } from "../src/assistant/tools.js";
import { OperatorService } from "../src/operator/service.js";
import { runCursorProcess } from "../src/operator/runtime.js";
import { saveOperatorSettings } from "../src/operator/settings.js";
import { activateSkillVersion, clearShadowVersion, listSkillVersions, markShadowVersion } from "../src/operator/skillVersions.js";
import { shadowProgress } from "../src/operator/shadow.js";

// TASK-074b-3a: the shadow path must never reach the tool executor or the cursor runner.
// Both are replaced with mocks that fail on call; a call would throw inside the routing path.
vi.mock("../src/assistant/tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/assistant/tools.js")>();
  return {
    ...actual,
    runTool: vi.fn(() => {
      throw new Error("runTool must not be called by shadow routing");
    }),
  };
});
vi.mock("../src/operator/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/operator/runtime.js")>();
  return {
    ...actual,
    runCursorProcess: vi.fn(() => {
      throw new Error("runCursorProcess must not be called by shadow routing");
    }),
  };
});

const roots: string[] = [];
const handles: Array<{ close(): void }> = [];
const NOW = new Date("2026-11-19T00:00:00.000Z");
const QUERY = "thử nghiệm shadow probe";
const ACTIVE_TOOLS = ["list_projects"];
const SHADOW_TOOLS = ["list_projects", "list_renders"];

function skillMarkdown(tools: string[], note: string) {
  return `---
name: shadow-probe
description: Thử nghiệm shadow probe trong app Video Agent
operator: true
area: tu-van-hanh
triggers:
  - ${QUERY}
tools:
${tools.map((tool) => `  - ${tool}`).join("\n")}
risk: read
---

# Thử nghiệm shadow

${note}
`;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-shadow-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  handles.push(opened.sqlite);
  const sqlite = opened.sqlite;
  const assistant = { setPendingListener: () => undefined } as unknown as AssistantService;
  const service = new OperatorService({
    sqlite: sqlite as never,
    dataDir: root,
    apiUrl: "http://127.0.0.1:1",
    assistant,
    llmProviders: {} as never,
    now: () => NOW,
  });
  // The active version is inserted directly so the test does not depend on the draft scoring rules.
  sqlite.prepare(
    "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, 1, ?, ?, 90, 'active', ?)",
  ).run("shadow-probe", skillMarkdown(ACTIVE_TOOLS, "Bản đang chạy."), JSON.stringify({ source: "user_review", runIds: [] }), NOW.toISOString());
  return { sqlite, service };
}

function addShadow(sqlite: ReturnType<typeof setup>["sqlite"]) {
  sqlite.prepare(
    "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, 2, ?, ?, 0, 'draft', ?)",
  ).run("shadow-probe", skillMarkdown(SHADOW_TOOLS, "Bản thử nghiệm."), JSON.stringify({ source: "user_review", runIds: [] }), NOW.toISOString());
  markShadowVersion(sqlite as never, "shadow-probe", 2);
}

function shadowRows(sqlite: ReturnType<typeof setup>["sqlite"]) {
  return sqlite.prepare("SELECT * FROM operator_skill_shadow_runs").all() as Array<Record<string, unknown>>;
}

function suggest(service: OperatorService, prompt: string, runId: string): string {
  return (service as unknown as { suggestion(p: string, r: string): string }).suggestion(prompt, runId);
}

beforeEach(() => {
  vi.mocked(runTool).mockClear();
  vi.mocked(runCursorProcess).mockClear();
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("operator skill shadow (TASK-074b-3a)", () => {
  it("gate off: routing with a shadow version writes no row", () => {
    const { sqlite, service } = setup();
    addShadow(sqlite);
    service.findSkills(QUERY);
    suggest(service, QUERY, "run-off");
    expect(shadowRows(sqlite)).toHaveLength(0);
  });

  it("gate on: one row per call with the declared tools, and the routing result is unchanged", () => {
    const { sqlite, service } = setup();
    addShadow(sqlite);
    const off = JSON.stringify(service.findSkills(QUERY));
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    const on = JSON.stringify(service.findSkills(QUERY));
    expect(on).toBe(off);
    const rows = shadowRows(sqlite);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      skill_name: "shadow-probe",
      shadow_version: 2,
      active_version: 1,
      rank: 1,
      query: QUERY,
      run_id: null,
    });
    expect(JSON.parse(rows[0].planned as string)).toEqual(SHADOW_TOOLS);
  });

  it("gate on: suggestion records one row per skill per run and leaves the suggestion text unchanged", () => {
    const { sqlite, service } = setup();
    addShadow(sqlite);
    const off = suggest(service, QUERY, "run-a");
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    const on = suggest(service, QUERY, "run-b");
    expect(on).toBe(off);
    const rows = shadowRows(sqlite);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ run_id: "run-b", skill_name: "shadow-probe" });
  });

  it("non-execution: with shadow tools declared, findSkills and suggestion return and neither runner is called", () => {
    const { sqlite, service } = setup();
    addShadow(sqlite);
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    expect(() => service.findSkills(QUERY)).not.toThrow();
    expect(() => suggest(service, QUERY, "run-exec")).not.toThrow();
    expect(runTool).not.toHaveBeenCalled();
    expect(runCursorProcess).not.toHaveBeenCalled();
    expect(shadowRows(sqlite).length).toBeGreaterThan(0);
  });

  it("the shadow version is never active and cannot be activated", () => {
    const { sqlite } = setup();
    addShadow(sqlite);
    const active = listSkillVersions(sqlite as never, true);
    expect(active.map((item) => item.version)).toEqual([1]);
    expect(active.some((item) => item.status === "shadow")).toBe(false);
    let caught: unknown;
    try {
      activateSkillVersion(sqlite as never, "shadow-probe", 2, new Map([["list_projects", "read"], ["list_renders", "read"]]));
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string } | undefined)?.code).toBe("SKILL_IS_SHADOW");
  });

  it("baseline: routing is identical before and after a shadow exists, and the hit stays the active version 1", () => {
    const { sqlite, service } = setup();
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    const before = JSON.stringify(service.findSkills(QUERY));
    const beforeSuggestion = suggest(service, QUERY, "run-base");
    addShadow(sqlite);
    const after = JSON.stringify(service.findSkills(QUERY));
    expect(after).toBe(before);
    expect(suggest(service, QUERY, "run-base-2")).toBe(beforeSuggestion);
    const hit = (JSON.parse(after) as { parts: Array<{ hits: Array<{ name: string; version: number }> }> }).parts
      .flatMap((part) => part.hits).find((item) => item.name === "shadow-probe");
    expect(hit?.version).toBe(1);
  });

  // TASK-152 Việc 1: the chat turn id is the shadow run id. Two calls in one turn count as one run.
  it("counts shadow runs by chat turn: two calls in one turn make one run, a second turn makes two", () => {
    const { sqlite, service } = setup();
    addShadow(sqlite);
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    service.findSkills(QUERY, "turn-a");
    service.findSkills(QUERY, "turn-a");
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW).runs).toBe(1);
    service.findSkills(QUERY, "turn-b");
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW).runs).toBe(2);
  });

  it("the shadow module imports no executor, runner, assistant registry or child_process", () => {
    const source = readFileSync(join(process.cwd(), "src/operator/shadow.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["better-sqlite3", "node:crypto", "./routing.js", "./settings.js", "./skillVersions.js", "./skills.js"].sort());
    for (const forbidden of ["assistant", "runtime", "cursorRuntime", "child_process", "tools"]) {
      expect(imports.some((item) => item.includes(forbidden))).toBe(false);
    }
  });

  it("shadow state rules: a new shadow returns the old one to draft, only a draft can be marked, and clearing returns it to draft", () => {
    const { sqlite } = setup();
    addShadow(sqlite);
    sqlite.prepare(
      "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, 3, ?, ?, 0, 'draft', ?)",
    ).run("shadow-probe", skillMarkdown(SHADOW_TOOLS, "Bản thử nghiệm thứ hai."), JSON.stringify({ source: "user_review", runIds: [] }), NOW.toISOString());
    const statuses = () => sqlite.prepare("SELECT version, status FROM operator_skill_versions WHERE name = ? ORDER BY version")
      .all("shadow-probe") as Array<{ version: number; status: string }>;

    markShadowVersion(sqlite as never, "shadow-probe", 3);
    expect(statuses()).toEqual([
      { version: 1, status: "active" },
      { version: 2, status: "draft" },
      { version: 3, status: "shadow" },
    ]);

    let refused: unknown;
    try {
      markShadowVersion(sqlite as never, "shadow-probe", 1);
    } catch (error) {
      refused = error;
    }
    expect((refused as { code?: string } | undefined)?.code).toBe("SKILL_NOT_DRAFT");

    expect(clearShadowVersion(sqlite as never, "shadow-probe")).toBe(1);
    expect(statuses().find((row) => row.version === 3)?.status).toBe("draft");
    expect(statuses().find((row) => row.version === 1)?.status).toBe("active");
  });

  it("a skill without a shadow version writes no rows even with the gate on", () => {
    const { sqlite, service } = setup();
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    service.findSkills(QUERY);
    suggest(service, QUERY, "run-plain");
    expect(shadowRows(sqlite)).toHaveLength(0);
  });
});
