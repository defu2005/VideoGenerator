import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
// TASK-122's focused fixture predates the fleet schema. Actual fleet + snapshot integration
// is covered against generated migrations in fleet.test.ts.
vi.mock("../src/fleet/service.js", () => ({ fleetOverview: () => ({ anomalies: [] }) }));
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { hardBlockMessage } from "../src/registry/policy.js";
import {
  currentDuty, dutyHeartbeat, DUTY_TTL_MS, isOnDuty,
} from "../src/supervision/duty.js";
import {
  AGENT_SOLVABLE_KINDS,
  DEFAULT_HERMES_DEADLINE_MIN,
  forwardEscalationToUser,
  getEscalation,
  listEscalations,
  MAX_HOPS,
  openEscalation,
  PROTECTED_PROJECT_ID,
  resolveEscalation,
  routeEscalation,
  sweepEscalations,
  USER_ONLY_KINDS,
} from "../src/supervision/escalations.js";
import {
  getKeyProfile,
  INTERNAL_OPERATOR,
  resolveTrustedAgent,
  saveKeyProfile,
} from "../src/supervision/identity.js";
import {
  acquireLease,
  getLease,
  holderRank,
  IDEMPOTENCY_TTL_MS,
  LEASE_TTL_MS,
  RANK,
  readIdempotent,
  RESOURCE_MAP,
  resourceOf,
  takeLeaseLoss,
  userBreakLease,
  writeIdempotent,
} from "../src/supervision/leases.js";
import {
  clearPauseBy,
  getOperatorPause,
  HERMES_OFFLINE_LIFT_MS,
  liftOrphanedHermesPause,
  MAX_HERMES_PAUSE_MIN,
  pauseByHermes,
  pauseByUser,
} from "../src/supervision/pause.js";
import {
  buildSupervisionSnapshot,
  setTelegramConflict,
  SNAPSHOT_MAX_BYTES,
} from "../src/supervision/snapshot.js";
import { supervisionToolDefs } from "../src/supervision/toolDefs.js";

function setupTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE agent_escalations (
      id TEXT PRIMARY KEY NOT NULL,
      from_kind TEXT NOT NULL,
      from_instance TEXT NOT NULL,
      to_kind TEXT NOT NULL,
      kind TEXT NOT NULL,
      object_ref TEXT DEFAULT '' NOT NULL,
      summary TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT DEFAULT 'open' NOT NULL,
      deadline_at TEXT,
      hops INTEGER DEFAULT 0 NOT NULL,
      claimed_by TEXT,
      resolved_by TEXT,
      outcome TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_idempotency (
      instance TEXT NOT NULL,
      key TEXT NOT NULL,
      tool TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX agent_idempotency_uq ON agent_idempotency (instance, key);
    CREATE TABLE agent_instances (
      instance TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      environment TEXT DEFAULT 'unknown' NOT NULL,
      version TEXT,
      last_seen_at TEXT NOT NULL,
      last_tool_at TEXT,
      duty_heartbeat_at TEXT,
      on_duty INTEGER DEFAULT 0 NOT NULL
    );
    CREATE TABLE agent_key_profiles (
      key_id TEXT PRIMARY KEY NOT NULL,
      agent_kind TEXT DEFAULT 'other' NOT NULL,
      instance_name TEXT DEFAULT 'unknown' NOT NULL,
      can_supervise INTEGER DEFAULT 0 NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_leases (
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      holder_kind TEXT NOT NULL,
      holder_instance TEXT NOT NULL,
      rank INTEGER NOT NULL,
      fence INTEGER DEFAULT 1 NOT NULL,
      run_id TEXT,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      preempted_by TEXT
    );
    CREATE UNIQUE INDEX agent_leases_resource_uq ON agent_leases (resource_kind, resource_id);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, project_id TEXT, stage TEXT, status TEXT, heartbeat_at TEXT, started_at TEXT, created_at TEXT, executor TEXT DEFAULT 'app');
    CREATE TABLE publications (id TEXT PRIMARY KEY, status TEXT, last_error TEXT, updated_at TEXT);
    CREATE TABLE assistant_pending_actions (id TEXT PRIMARY KEY, status TEXT, summary TEXT, created_at TEXT);
    CREATE TABLE operator_runs (id TEXT PRIMARY KEY, status TEXT, created_at TEXT);
    CREATE TABLE operator_tool_audit (id TEXT PRIMARY KEY, run_id TEXT, agent_kind TEXT, agent_name TEXT, agent_model TEXT, tool TEXT, summary TEXT, decision TEXT, created_at TEXT);
    CREATE TABLE supervisor_findings (id TEXT PRIMARY KEY, kind TEXT, severity TEXT, dedupe_key TEXT, status TEXT);
  `);
  return sqlite;
}

describe("TASK-122: Supervision", () => {
  describe("1. Trusted Identity from machine key", () => {
    it("binds identity from machine key and ignores spoofed kind in headers", () => {
      const sqlite = setupTestDb();
      saveKeyProfile(sqlite, "key-operator-1", { agentKind: "operator", instanceName: "worker-1", canSupervise: false });

      // Request claims to be hermes in header, but key says operator
      const resolved = resolveTrustedAgent({
        sqlite,
        keyId: "key-operator-1",
        headers: { "x-vg-agent-kind": "hermes", "x-vg-agent-model": "custom-llm" },
      });

      expect(resolved.kind).toBe("operator");
      expect(resolved.canSupervise).toBe(false);
      expect(resolved.model).toBe("custom-llm");
      expect(resolved.instance).toBe("operator/worker-1");
      expect(resolved.trusted).toBe(true);

      sqlite.close();
    });

    it("hard-blocks attempts by agents to alter agentKind or canSupervise via policy rule 4", () => {
      expect(hardBlockMessage("any_tool", { agentKind: "hermes" })).toMatch(/quyền tự vận hành/);
      expect(hardBlockMessage("any_tool", { canSupervise: true })).toMatch(/quyền tự vận hành/);
      expect(hardBlockMessage("any_tool", { nested: { canSupervise: true } })).toMatch(/quyền tự vận hành/);
    });

    it("provides fixed internal operator identity without key", () => {
      expect(INTERNAL_OPERATOR).toEqual({
        kind: "operator",
        name: "app",
        model: null,
        environment: "app",
        instance: "operator/app",
        canSupervise: false,
        trusted: true,
      });
    });
  });

  describe("2. Leases & Preemption", () => {
    it("allows Hermes on duty to preempt operator and records preemption loss", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");
      const ref = { kind: "project" as const, id: "proj-1" };

      // Operator acquires lease
      const opRank = holderRank("operator", false);
      const opAcquire = acquireLease(sqlite, ref, { kind: "operator", instance: "operator/app", rank: opRank, runId: "run-123" }, now);
      expect(opAcquire.ok).toBe(true);

      // Hermes on duty preempts operator
      const hermesRank = holderRank("hermes", true);
      const hermesAcquire = acquireLease(sqlite, ref, { kind: "hermes", instance: "hermes/main", rank: hermesRank }, now);
      expect(hermesAcquire.ok).toBe(true);
      if (hermesAcquire.ok) {
        expect(hermesAcquire.preempted).toEqual({ holderInstance: "operator/app", runId: "run-123" });
      }

      // Operator run checks its next step and discovers it lost the lease
      const loss = takeLeaseLoss(sqlite, "run-123");
      expect(loss).toEqual({ by: "hermes/main", kind: "hermes", resource: "project:proj-1" });

      sqlite.close();
    });

    it("prevents operator from preempting Hermes", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");
      const ref = { kind: "project" as const, id: "proj-1" };

      // Hermes on duty acquires lease
      const hermesRank = holderRank("hermes", true);
      acquireLease(sqlite, ref, { kind: "hermes", instance: "hermes/main", rank: hermesRank }, now);

      // Operator tries to acquire the same project
      const opRank = holderRank("operator", false);
      const opAcquire = acquireLease(sqlite, ref, { kind: "operator", instance: "operator/app", rank: opRank }, now);
      expect(opAcquire.ok).toBe(false);
      if (!opAcquire.ok) {
        expect(opAcquire.code).toBe("LEASED");
        expect(opAcquire.holder.instance).toBe("hermes/main");
      }

      sqlite.close();
    });

    it("lets a user action break any agent lease", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");
      const ref = { kind: "project" as const, id: "proj-1" };

      acquireLease(sqlite, ref, { kind: "hermes", instance: "hermes/main", rank: RANK.hermesDuty }, now);
      expect(getLease(sqlite, ref, now)).not.toBeNull();

      const brokenHolder = userBreakLease(sqlite, ref, now);
      expect(brokenHolder).toBe("hermes/main");
      // The lease is freed immediately so the object is unleased
      expect(getLease(sqlite, ref, now)).toBeNull();

      sqlite.close();
    });

    it("allows taking an expired lease", () => {
      const sqlite = setupTestDb();
      const t0 = new Date("2026-11-13T10:00:00.000Z");
      const ref = { kind: "project" as const, id: "proj-1" };

      acquireLease(sqlite, ref, { kind: "hermes", instance: "hermes/old", rank: RANK.hermesDuty }, t0);

      // 11 minutes later, lease expired
      const t1 = new Date(t0.getTime() + LEASE_TTL_MS + 60_000);
      const opRank = holderRank("operator", false);
      const opAcquire = acquireLease(sqlite, ref, { kind: "operator", instance: "operator/app", rank: opRank }, t1);
      expect(opAcquire.ok).toBe(true);

      const lease = getLease(sqlite, ref, t1);
      expect(lease?.holderInstance).toBe("operator/app");

      sqlite.close();
    });

    it("maps every mutating assistant and supervision tool in RESOURCE_MAP", () => {
      const allTools = [...Object.values(ASSISTANT_TOOLS), ...supervisionToolDefs];
      const unmapped: string[] = [];
      for (const tool of allTools) {
        if (tool.risk !== "read") {
          const spec = RESOURCE_MAP[tool.name];
          if (!spec) unmapped.push(tool.name);
        }
      }
      expect(unmapped).toEqual([]);
    });
  });

  describe("3. Idempotency", () => {
    it("returns stored result for repeated call with same idempotencyKey within 24h", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");

      writeIdempotent(sqlite, "hermes/main", "idem-1", "make_shorts", { shortsId: "s-100" }, now);
      const read1 = readIdempotent(sqlite, "hermes/main", "idem-1", now);
      expect(read1).toEqual({ result: { shortsId: "s-100" } });

      // After 25 hours, key is pruned
      const later = new Date(now.getTime() + IDEMPOTENCY_TTL_MS + 1000);
      const read2 = readIdempotent(sqlite, "hermes/main", "idem-1", later);
      expect(read2).toBeNull();

      sqlite.close();
    });
  });

  describe("4. Duty Heartbeat & Election", () => {
    it("elects the first caller on duty and keeps others as standby", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");

      const agent1 = { kind: "hermes" as const, name: "h1", instance: "hermes/h1", canSupervise: true, trusted: true, model: null, environment: "wsl" };
      const agent2 = { kind: "hermes" as const, name: "h2", instance: "hermes/h2", canSupervise: true, trusted: true, model: null, environment: "wsl" };

      const res1 = dutyHeartbeat(sqlite, agent1, "1.0.0", now);
      expect(res1.onDuty).toBe(true);
      expect(res1.holder).toBe("hermes/h1");
      expect(currentDuty(sqlite, now)?.instance).toBe("hermes/h1");

      const res2 = dutyHeartbeat(sqlite, agent2, "1.0.0", now);
      expect(res2.onDuty).toBe(false);
      expect(res2.holder).toBe("hermes/h1");

      sqlite.close();
    });

    it("prevents an agent without canSupervise from taking duty", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");
      const agentNoSupervise = { kind: "hermes" as const, name: "h3", instance: "hermes/h3", canSupervise: false, trusted: true, model: null, environment: "wsl" };

      const res = dutyHeartbeat(sqlite, agentNoSupervise, "1.0.0", now);
      expect(res.onDuty).toBe(false);
      expect(currentDuty(sqlite, now)).toBeNull();

      sqlite.close();
    });

    it("lets standby instance take duty after TTL expires", () => {
      const sqlite = setupTestDb();
      const t0 = new Date("2026-11-13T10:00:00.000Z");

      const agent1 = { kind: "hermes" as const, name: "h1", instance: "hermes/h1", canSupervise: true, trusted: true, model: null, environment: "wsl" };
      const agent2 = { kind: "hermes" as const, name: "h2", instance: "hermes/h2", canSupervise: true, trusted: true, model: null, environment: "wsl" };

      dutyHeartbeat(sqlite, agent1, "1.0.0", t0);
      expect(currentDuty(sqlite, t0)?.instance).toBe("hermes/h1");

      // 4 minutes later (> 3 min TTL)
      const t1 = new Date(t0.getTime() + DUTY_TTL_MS + 60_000);
      const res2 = dutyHeartbeat(sqlite, agent2, "1.0.0", t1);
      expect(res2.onDuty).toBe(true);
      expect(res2.holder).toBe("hermes/h2");

      sqlite.close();
    });
  });

  describe("5. Escalation Routing Table", () => {
    it("routes solvable kinds to Hermes when on duty, user-only kinds to user", () => {
      for (const kind of AGENT_SOLVABLE_KINDS) {
        expect(routeEscalation({ kind, hermesOnDuty: true })).toEqual({ to: "hermes", reason: "Agent xử lý được." });
        expect(routeEscalation({ kind, hermesOnDuty: false })).toEqual({ to: "user", reason: "Hermes chưa trực." });
      }

      for (const kind of USER_ONLY_KINDS) {
        expect(routeEscalation({ kind, hermesOnDuty: true })).toEqual({ to: "user", reason: "Chỉ người dùng được quyết định." });
      }
    });

    it("always routes protected project to user", () => {
      expect(routeEscalation({
        kind: "held_quality_gate",
        projectId: PROTECTED_PROJECT_ID,
        hermesOnDuty: true,
      })).toEqual({ to: "user", reason: "Dự án được bảo vệ." });
    });

    it("routes to user when userRequested is true", () => {
      expect(routeEscalation({
        kind: "held_quality_gate",
        userRequested: true,
        hermesOnDuty: true,
      })).toEqual({ to: "user", reason: "Người dùng muốn tự xem." });
    });

    it("enforces 3 hops ping-pong limit and forwards to user", () => {
      expect(routeEscalation({
        kind: "held_quality_gate",
        hops: MAX_HOPS,
        hermesOnDuty: true,
      })).toEqual({ to: "user", reason: "Đã chuyển qua lại 3 lần." });
    });

    it("sweeps late escalations and forwards to user with 'Hermes chưa xử lý kịp'", () => {
      const sqlite = setupTestDb();
      const t0 = new Date("2026-11-13T10:00:00.000Z");

      // Heartbeat so Hermes is on duty
      const agent = { kind: "hermes" as const, name: "h1", instance: "hermes/h1", canSupervise: true, trusted: true, model: null, environment: "wsl" };
      dutyHeartbeat(sqlite, agent, "1.0.0", t0);

      const esc = openEscalation(sqlite, {
        fromKind: "operator",
        fromInstance: "app",
        kind: "held_quality_gate",
        objectRef: "proj-1",
        summary: "Kịch bản chưa đạt điểm",
      }, t0);
      expect(esc.toKind).toBe("hermes");

      // 31 minutes later (> 30 min deadline)
      const t1 = new Date(t0.getTime() + (DEFAULT_HERMES_DEADLINE_MIN + 1) * 60_000);
      // Keep duty alive at t1
      dutyHeartbeat(sqlite, agent, "1.0.0", t1);

      const swept = sweepEscalations(sqlite, t1);
      expect(swept.length).toBe(1);
      expect(swept[0].toKind).toBe("user");
      expect(swept[0].status).toBe("forwarded");
      expect(swept[0].note).toBe("Hermes chưa xử lý kịp");

      sqlite.close();
    });

    it("forwards all open Hermes escalations to user when duty is lost", () => {
      const sqlite = setupTestDb();
      const t0 = new Date("2026-11-13T10:00:00.000Z");

      const agent = { kind: "hermes" as const, name: "h1", instance: "hermes/h1", canSupervise: true, trusted: true, model: null, environment: "wsl" };
      dutyHeartbeat(sqlite, agent, "1.0.0", t0);

      openEscalation(sqlite, {
        fromKind: "operator",
        fromInstance: "app",
        kind: "held_quality_gate",
        objectRef: "proj-1",
        summary: "Kịch bản chưa đạt điểm",
      }, t0);

      // 10 minutes later without heartbeat -> duty lost
      const t1 = new Date(t0.getTime() + 10 * 60_000);
      expect(currentDuty(sqlite, t1)).toBeNull();

      const swept = sweepEscalations(sqlite, t1);
      expect(swept.length).toBe(1);
      expect(swept[0].note).toBe("Hermes không còn trực");

      sqlite.close();
    });
  });

  describe("6. Fail-Safe", () => {
    it("caps Hermes pause at 360 minutes (6 hours)", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");

      const result = pauseByHermes(sqlite, "hermes/main", 1000, "Bảo trì", now);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const until = new Date(result.pause.until);
        const diffMinutes = Math.round((until.getTime() - now.getTime()) / 60_000);
        expect(diffMinutes).toBe(MAX_HERMES_PAUSE_MIN);
      }

      sqlite.close();
    });

    it("prevents Hermes from overriding or resuming a user /stop", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");

      pauseByUser(sqlite, now);
      const current = getOperatorPause(sqlite, now);
      expect(current?.by).toBe("user");

      const pauseRes = pauseByHermes(sqlite, "hermes/main", 60, "Hermes muốn dừng", now);
      expect(pauseRes.ok).toBe(false);

      const resumeRes = clearPauseBy(sqlite, "hermes", now);
      expect(resumeRes.ok).toBe(false);
      expect(resumeRes.message).toMatch(/người dùng/);

      sqlite.close();
    });

    it("lifts an orphaned Hermes pause after 10 minutes without duty heartbeat", () => {
      const sqlite = setupTestDb();
      const t0 = new Date("2026-11-13T10:00:00.000Z");

      pauseByHermes(sqlite, "hermes/main", 60, "Tạm dừng kiểm tra", t0);
      expect(getOperatorPause(sqlite, t0)).not.toBeNull();

      // At 5 minutes: still within 10 min window
      const t5 = new Date(t0.getTime() + 5 * 60_000);
      expect(liftOrphanedHermesPause(sqlite, t5)).toBeNull();

      // At 11 minutes: offline > 10m -> lifted
      const t11 = new Date(t0.getTime() + HERMES_OFFLINE_LIFT_MS + 60_000);
      const lifted = liftOrphanedHermesPause(sqlite, t11);
      expect(lifted).not.toBeNull();
      expect(getOperatorPause(sqlite, t11)).toBeNull();

      sqlite.close();
    });
  });

  describe("7. Snapshot & Anomaly Rules", () => {
    it("returns calm snapshot with empty anomalies and size under 3KB", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");

      const snapshot = buildSupervisionSnapshot(sqlite, now);
      expect(snapshot.anomalies).toEqual([]);
      const json = JSON.stringify(snapshot);
      expect(json.length).toBeLessThan(SNAPSHOT_MAX_BYTES);
      expect(json.length).toBeLessThan(3000);

      sqlite.close();
    });

    it("detects stuck job, publish failure, held gates, and telegram conflict anomalies", () => {
      const sqlite = setupTestDb();
      const now = new Date("2026-11-13T10:00:00.000Z");

      // Stuck job (> 30 min running without heartbeat)
      sqlite.prepare(`
        INSERT INTO jobs (id, stage, status, heartbeat_at)
        VALUES ('job-stuck-1', 'RENDER', 'RUNNING', ?)
      `).run(new Date(now.getTime() - 35 * 60_000).toISOString());

      // Failed publication
      sqlite.prepare(`
        INSERT INTO publications (id, status, last_error, updated_at)
        VALUES ('pub-1', 'FAILED', 'TikTok rate limit', ?)
      `).run(new Date(now.getTime() - 10 * 60_000).toISOString());

      // Held gate
      sqlite.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('autonomy.heldGates', ?, ?)
      `).run(JSON.stringify([{ projectId: "proj-held", check: "Thiếu độ dài" }]), now.toISOString());

      // Telegram conflict
      setTelegramConflict(sqlite, true);

      const snapshot = buildSupervisionSnapshot(sqlite, now);
      const anomalies = snapshot.anomalies as Array<{ kind: string; ref: string }>;
      const kinds = anomalies.map((a) => a.kind);

      expect(kinds).toContain("stuck_job");
      expect(kinds).toContain("publish_failure");
      expect(kinds).toContain("held_quality_gate");
      expect(kinds).toContain("telegram_conflict");

      sqlite.close();
    });
  });
});
