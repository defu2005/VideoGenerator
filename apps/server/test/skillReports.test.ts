import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { logToolAudit } from "../src/registry/audit.js";
import { parseAgentIdentity } from "../src/reports/agentIdentity.js";
import { skillHash } from "../src/reports/skillHash.js";
import { checkDueSkillReports, metricReached, verdictFor } from "../src/reports/checkSkillReports.js";
import { claimSkillRun, saveSkillReport } from "../src/reports/skillReportService.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function database() {
  const root = mkdtempSync(join(tmpdir(), "vg-report-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  return opened;
}

const codex = { kind: "codex", name: "codex-pc", model: "gpt", environment: "may-nha" };
const hermes = { kind: "hermes", name: "hermes-vps", model: null, environment: "vps-1" };

describe("agent identity and skill hash", () => {
  it("cleans bad headers and hashes both line endings the same way", () => {
    expect(parseAgentIdentity({})).toEqual({ kind: "other", name: "unknown", model: null, environment: "unknown" });
    expect(parseAgentIdentity({
      "x-vg-agent-kind": "nope",
      "x-vg-agent-name": "tên có dấu",
      "x-vg-agent-model": "claude-sonnet",
      "x-vg-environment": "may nha",
    })).toEqual({ kind: "other", name: "unknown", model: "claude-sonnet", environment: "may nha" });
    expect(skillHash("dòng\r\nmột")).toBe(skillHash("dòng\nmột"));
  });
});

describe("skill claims and reports", () => {
  it("lets one agent hold a skill and releases the claim when the report is saved", () => {
    const opened = database();
    opened.sqlite.prepare(
      "INSERT INTO profiles (id, name, default_brief, guidelines, created_at, updated_at) VALUES (?, ?, '{}', '{}', ?, ?)",
    ).run("11111111-1111-4111-8111-111111111111", "Kênh A", "2026-11-10T00:00:00.000Z", "2026-11-10T00:00:00.000Z");
    const first = claimSkillRun(opened.sqlite, { skill: "video-lich-san-xuat", profileId: "11111111-1111-4111-8111-111111111111", agent: codex, now: new Date("2026-11-10T01:00:00.000Z") });
    const second = claimSkillRun(opened.sqlite, { skill: "video-lich-san-xuat", profileId: "11111111-1111-4111-8111-111111111111", agent: hermes, now: new Date("2026-11-10T01:05:00.000Z") });
    const extended = claimSkillRun(opened.sqlite, { skill: "video-lich-san-xuat", profileId: "11111111-1111-4111-8111-111111111111", agent: codex, now: new Date("2026-11-10T01:10:00.000Z") });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.heldBy.name).toBe("codex-pc");
    expect(extended.ok && first.ok && extended.claimId).toBe(first.ok ? first.claimId : "");
    const saved = saveSkillReport(opened.sqlite, {
      skill: "video-lich-san-xuat",
      skillHash: "abcd1234",
      profileId: "11111111-1111-4111-8111-111111111111",
      startedAt: "2026-11-10T01:00:00.000Z",
      status: "done",
      hypothesis: "Đăng đều sẽ tăng giờ xem.",
      metrics: [{ name: "published_count", target: 3, direction: "up" }],
      checkAt: "2026-11-17",
      claimId: first.ok ? first.claimId : undefined,
    }, codex, "may-nha");
    const claim = opened.sqlite.prepare("SELECT released_at, report_id FROM skill_claims WHERE id = ?").get(first.ok ? first.claimId : "") as { released_at: string; report_id: string };
    const report = opened.sqlite.prepare("SELECT agent_name, agent_environment FROM skill_reports WHERE id = ?").get(saved.id) as { agent_name: string; agent_environment: string };
    expect(claim.released_at).toBeTruthy();
    expect(claim.report_id).toBe(saved.id);
    expect(report).toEqual({ agent_name: "codex-pc", agent_environment: "may-nha" });
    expect(() => saveSkillReport(opened.sqlite, {
      skill: "video-lich-san-xuat",
      skillHash: "abcd1234",
      profileName: "Kênh A",
      startedAt: "2026-11-10T02:00:00.000Z",
      status: "done",
      hypothesis: "sk-abcdefghijklmnopqrst trong giả thuyết",
      metrics: [{ name: "published_count", direction: "up" }],
      checkAt: "2026-11-17",
    }, codex, "may-nha")).toThrow(/hypothesis/);
    opened.sqlite.close();
  });

  it("writes the caller identity on the audit row and counts an agent once a minute", () => {
    const opened = database();
    logToolAudit(opened.sqlite, {
      source: "mcp", tool: "get_agent_context", args: {}, risk: "read", decision: "executed", summary: "Bối cảnh",
      agentKind: codex.kind, agentName: codex.name, agentModel: codex.model, agentEnvironment: codex.environment,
      at: "2026-11-10T03:00:00.000Z",
    });
    logToolAudit(opened.sqlite, {
      source: "mcp", tool: "get_agent_context", args: {}, risk: "read", decision: "executed", summary: "Bối cảnh",
      agentKind: codex.kind, agentName: codex.name, agentModel: codex.model, agentEnvironment: codex.environment,
      at: "2026-11-10T03:00:10.000Z",
    });
    const audit = opened.sqlite.prepare("SELECT agent_kind, agent_name FROM operator_tool_audit").all();
    const agent = opened.sqlite.prepare("SELECT calls FROM agents WHERE name = ?").get("codex-pc") as { calls: number };
    expect(audit).toHaveLength(2);
    expect(agent.calls).toBe(1);
    opened.sqlite.close();
  });

  it("marks a due report dung, sai, or unclear and postpones a young video", () => {
    const reached = { name: "views_7d", baseline: 1, target: 10, actual: 12, direction: "up" as const };
    const missed = { ...reached, actual: 2 };
    const lower = { name: "policy_warnings", baseline: 2, target: 1, actual: 0, direction: "down" as const };
    expect(metricReached(lower)).toBe(true);
    expect(verdictFor([reached, reached, reached], 3)).toBe("dung");
    expect(verdictFor([missed], 3)).toBe("sai");
    expect(verdictFor([reached, missed], 3)).toBe("chua_ro");
    expect(verdictFor([reached], 2)).toBe("chua_ro");
    expect(verdictFor([reached], 1)).toBe("dung");
    expect(verdictFor([{ ...reached, actual: null }], 3)).toBeNull();

    const opened = database();
    opened.sqlite.pragma("foreign_keys = OFF");
    const now = new Date("2026-11-10T02:00:00.000Z");
    const young = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    opened.sqlite.prepare(
      `INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, created_at, updated_at, published_at)
       VALUES ('pub-young', 'project', 'render', 'account', 'PUBLISHED', 'public', 'public', ?, ?, ?)`,
    ).run(young, young, young);
    saveSkillReport(opened.sqlite, {
      skill: "video-doc-so-lieu",
      skillHash: "abcd1234",
      profileName: "Kênh A",
      subjects: { publicationIds: ["pub-young"] },
      startedAt: "2026-11-01T00:00:00.000Z",
      status: "done",
      hypothesis: "Số liệu tuần này tăng.",
      metrics: [{ name: "published_count", target: 1, direction: "up" }],
      checkAt: "2026-11-09",
    }, codex, "may-nha");
    const first = checkDueSkillReports(opened.sqlite, now);
    const moved = opened.sqlite.prepare("SELECT check_at, verdict FROM skill_reports").get() as { check_at: string; verdict: string | null };
    expect(first.due).toBe(1);
    expect(moved.verdict).toBeNull();
    expect(moved.check_at > "2026-11-10").toBe(true);
    opened.sqlite.close();
  });
});
