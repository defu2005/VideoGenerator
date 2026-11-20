import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { behaviourReason, readBehaviourEval, shadowGateRefusal } from "../src/operator/behaviourGate.js";
import { activateSkillVersion } from "../src/operator/skillVersions.js";
import { OPERATOR_SKILLS, parseSkillMarkdown, renderSkillMarkdown } from "../src/operator/skills.js";

// TASK-152 Việc 2. A corrupt stored eval row must fail closed: no throw, the gate sees "no result",
// and the refusal says the stored result could not be read (not "never ran").
function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
  return db;
}

describe("readBehaviourEval fails closed on corrupt storage", () => {
  it("returns null when the stored value is not valid JSON, and logs a warning", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("operator.behaviourEval.some-skill.v3", "{not json", new Date().toISOString());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() => readBehaviourEval(db, "some-skill", 3)).not.toThrow();
      expect(readBehaviourEval(db, "some-skill", 3)).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      db.close();
    }
  });

  it("still returns null when no row exists", () => {
    const db = memoryDb();
    expect(readBehaviourEval(db, "missing", 1)).toBeNull();
    db.close();
  });
});

describe("behaviourReason tells a missing row from a corrupt one", () => {
  it("a missing row says the eval never ran", () => {
    const db = memoryDb();
    expect(behaviourReason(db, "missing", 1)).toBe("chưa chạy eval hành vi");
    db.close();
  });

  it("a row that parses to the literal null, an array or a number is corrupt, not a result (no TypeError)", () => {
    const db = memoryDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const [i, value] of ["null", "[]", "42"].entries()) {
        db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
          .run(`operator.behaviourEval.odd-skill.v${i + 1}`, value, new Date().toISOString());
        expect(() => behaviourReason(db, "odd-skill", i + 1)).not.toThrow();
        expect(behaviourReason(db, "odd-skill", i + 1)).toBe("eval hành vi không đọc được: chạy lại eval hành vi");
        expect(readBehaviourEval(db, "odd-skill", i + 1)).toBeNull();
      }
    } finally {
      warn.mockRestore();
      db.close();
    }
  });

  it("a corrupt row says it could not be read, and the shadow gate refuses with a coded error", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("operator.behaviourEval.some-skill.v3", "{not json", new Date().toISOString());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(behaviourReason(db, "some-skill", 3)).toBe("eval hành vi không đọc được: chạy lại eval hành vi");
      const refusal = shadowGateRefusal({ baseline: { version: null }, result: readBehaviourEval(db, "some-skill", 3) });
      expect(refusal?.code).toBe("SKILL_BEHAVIOUR_NOT_RUN");
    } finally {
      warn.mockRestore();
      db.close();
    }
  });
});

describe("manual activation refuses a draft whose stored eval is corrupt", () => {
  it("throws with the corrupt-row reason and leaves the draft as a draft", () => {
    const root = mkdtempSync(join(tmpdir(), "vg-behaviour-corrupt-"));
    const opened = openDatabase(join(root, "app.db"));
    migrateDatabase(opened.db);
    const sqlite = opened.sqlite;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const base = renderSkillMarkdown(OPERATOR_SKILLS[0]!);
      const parsed = parseSkillMarkdown(base)!;
      const reg = new Map(parsed.tools.map((tool) => [tool, parsed.risk as "read" | "safe" | "confirm"] as const));
      const now = new Date().toISOString();
      sqlite.prepare("INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, 1, ?, ?, 0, 'draft', ?)")
        .run(parsed.name, base, JSON.stringify({ source: "pattern", runIds: [] }), now);
      sqlite.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
        .run(`operator.behaviourEval.${parsed.name}.v1`, "{not json", now);
      expect(() => activateSkillVersion(sqlite, parsed.name, 1, reg)).toThrow(/eval hành vi không đọc được/);
      const row = sqlite.prepare("SELECT status FROM operator_skill_versions WHERE name = ? AND version = 1").get(parsed.name) as { status: string };
      expect(row.status).toBe("draft");
    } finally {
      warn.mockRestore();
      opened.sqlite.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
