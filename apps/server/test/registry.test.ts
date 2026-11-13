import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTONOMY_PRESETS, PROTECTED_PROJECT_ID } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { collectOperatorEvents, dispatchOperatorEvents, eventWakeRunId, saveOperatorEventRule } from "../src/operator/events.js";
import { setAutomationPaused } from "../src/services/automationSettings.js";
import { claimOperatorAction, recordOperatorActionFailure } from "../src/operator/loopGuard.js";
import { autonomyBudgetStatus, recordBudgetFindings, saveAutonomyBudget } from "../src/operator/autonomyBudget.js";
import { breakerAllowsStart, claimBreakerTrial, listCircuitBreakers, recordBreakerOutcome } from "../src/operator/circuitBreaker.js";
import { saveAutonomySettings } from "../src/operator/autonomy.js";
import { AutonomySupervisor, listSupervisorState } from "../src/operator/supervisor.js";
import { autonomyJobCounts, jobWithinAutonomyLimit } from "../src/operator/autonomyJobLimits.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-registry-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "registry.db"),
    PORT: "3012",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    WEB_BASE_URL: "http://localhost:5180",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  app = buildApp({ testActor,  config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("tool registry", () => {
  it("keeps the same local publish time across a DST change when finding slots without renders", async () => {
    const { sqlite, orchestrator, usage } = app.vgAssistant.service.toolContext();
    const profileId = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "DST fixture" } })).json().id;
    const settings = { level: "supervised" as const, grants: AUTONOMY_PRESETS.supervised };
    saveAutonomySettings(sqlite, settings);
    saveAutonomySettings(sqlite, settings, profileId);
    saveAutonomyBudget(sqlite, { dailyUsd: 0 }, profileId);
    sqlite.prepare("UPDATE profiles SET automation = ? WHERE id = ?")
      .run(JSON.stringify({ enabled: true, timezone: "America/New_York", publishTimes: ["19:00"], leadTimeHours: 6 }), profileId);
    const account = await app.inject({
      method: "POST", url: `/api/profiles/${profileId}/accounts`, payload: { platform: "youtube", displayName: "Fixture" },
    });
    expect(account.statusCode).toBe(201);
    let now = new Date("2026-10-31T20:00:00Z");
    const supervisor = new AutonomySupervisor({
      repository: orchestrator.repository, usage, stageTimeoutMs: 60_000, logger: app.log, now: () => now,
    });
    try {
      supervisor.runPass();
      const slot = () => listSupervisorState(sqlite, profileId).findings.find(({ kind }) => kind === "slot_at_risk")?.detail;
      expect(slot()).toMatchObject({ publishAt: "2026-10-31T23:00:00.000Z" });
      expect(listSupervisorState(sqlite, profileId).findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "account_attention", detail: expect.objectContaining({ note: expect.stringContaining("Testing") }) }),
        expect.objectContaining({ kind: "topics_low" }),
        expect.objectContaining({ kind: "budget_stop" }),
      ]));
      now = new Date("2026-11-01T20:00:00Z");
      supervisor.runPass();
      expect(slot()).toMatchObject({ publishAt: "2026-11-02T00:00:00.000Z" });
    } finally {
      sqlite.prepare("DELETE FROM supervisor_heartbeats").run();
      sqlite.prepare("DELETE FROM supervisor_findings WHERE profile_id = ?").run(profileId);
      sqlite.prepare("DELETE FROM app_settings WHERE key = 'autonomy.app'").run();
      sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(`autonomy.budget.${profileId}`);
      sqlite.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
    }
  });
  it("observes stalls and disk pressure, keeps seven days of heartbeats and nudges a stuck worker once", async () => {
    const { sqlite, orchestrator, usage } = app.vgAssistant.service.toolContext();
    const profileId = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Supervisor fixture" } })).json().id;
    const projectId = (await app.inject({
      method: "POST", url: "/api/projects", payload: { topic: "Supervisor fixture", profileId },
    })).json().id;
    const settings = { level: "supervised" as const, grants: AUTONOMY_PRESETS.supervised };
    saveAutonomySettings(sqlite, settings);
    saveAutonomySettings(sqlite, settings, profileId);
    const job = orchestrator.repository.createJob({ projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
    const render = orchestrator.repository.createJob({ projectId, stage: "RENDER", maxAttempts: 3, previousState: "PENDING" });
    orchestrator.repository.updateJob(job.id, { status: "RUNNING", startedAt: "2026-11-09T00:00:00.000Z" });
    sqlite.prepare("INSERT INTO supervisor_heartbeats (observed_at, running_jobs, queued_jobs, finding_count) VALUES (?, 0, 0, 0)")
      .run("2026-11-01T00:00:00.000Z");
    let now = new Date("2026-11-10T01:00:00.000Z");
    let lastClaimAt: string | null = null;
    let free = 1;
    let nudges = 0;
    const alerts: string[] = [];
    const supervisor = new AutonomySupervisor({
      repository: orchestrator.repository, usage, stageTimeoutMs: 60_000, logger: app.log,
      now: () => now, diskFreeBytes: () => free,
      worker: { readySince: () => "2026-11-10T00:48:00.000Z", lastClaimAt: () => lastClaimAt, nudge: () => { nudges++; } },
      notify: ({ message }) => { alerts.push(message); },
    });
    try {
      supervisor.recordStartup();
      supervisor.runPass();
      expect(orchestrator.startJob(render.id)).toBeUndefined();
      now = new Date("2026-11-10T01:02:00.000Z");
      supervisor.runPass();
      expect(nudges).toBe(1);
      expect(alerts).toHaveLength(3);
      const state = listSupervisorState(sqlite);
      expect(state.heartbeat).toMatchObject({ observedAt: now.toISOString(), runningJobs: 1 });
      expect(state.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "restarted", detail: expect.objectContaining({ recoveredJobs: 1 }) }),
        expect.objectContaining({ kind: "job_stalled", status: "open", lastSeenAt: now.toISOString() }),
        expect.objectContaining({ kind: "disk_low" }),
        expect.objectContaining({ kind: "worker_idle", status: "escalated", severity: "critical" }),
      ]));
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM supervisor_heartbeats").get()).toEqual({ count: 2 });
      lastClaimAt = now.toISOString();
      free = 10 * 1024 ** 3;
      orchestrator.repository.updateJob(job.id, { status: "CANCELLED" });
      supervisor.runPass();
      expect(listSupervisorState(sqlite).findings.filter((item) => ["job_stalled", "worker_idle", "disk_low"].includes(item.kind)))
        .toHaveLength(0);
      expect(orchestrator.canStartQueuedJob(render, now)).toBe(true);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM supervisor_findings WHERE status = 'resolved' AND kind IN ('job_stalled','worker_idle','disk_low')").get())
        .toEqual({ count: 3 });
    } finally {
      sqlite.prepare("DELETE FROM jobs WHERE id IN (?, ?)").run(job.id, render.id);
      sqlite.prepare("DELETE FROM app_settings WHERE key = 'autonomy.app'").run();
    }
  });
  it("reserves the last render slot on claim and renews the limit the next local day", async () => {
    const { sqlite, orchestrator } = app.vgAssistant.service.toolContext();
    const createProject = async () => (await app.inject({
      method: "POST", url: "/api/projects", payload: { topic: "Render limit fixture" },
    })).json().id as string;
    const first = await createProject();
    const second = await createProject();
    saveAutonomyBudget(sqlite, { maxRendersPerDay: 1 });
    try {
      const job1 = orchestrator.repository.createJob({ projectId: first, stage: "RENDER", previousState: "PENDING", maxAttempts: 2 });
      const job2 = orchestrator.repository.createJob({ projectId: second, stage: "RENDER", previousState: "PENDING", maxAttempts: 2 });
      expect(orchestrator.startJob(job1.id)?.status).toBe("RUNNING");
      expect(orchestrator.startJob(job2.id)).toBeUndefined();
      expect(orchestrator.repository.getJob(job2.id)?.status).toBe("QUEUED");
      expect(orchestrator.canStartQueuedJob(job2, new Date())).toBe(false);
      const budget = autonomyBudgetStatus(sqlite, app.vgAssistant.service.toolContext().usage);
      expect(autonomyJobCounts(sqlite, budget.day)).toEqual({ render: 1, publishes: [] });
      expect(jobWithinAutonomyLimit(sqlite, job2, new Date(Date.now() + 86_400_000))).toBe(true);
    } finally {
      sqlite.prepare("DELETE FROM jobs WHERE project_id IN (?, ?)").run(first, second);
      sqlite.prepare("DELETE FROM autonomy_job_claims WHERE stage = 'RENDER'").run();
      sqlite.prepare("DELETE FROM app_settings WHERE key = 'autonomy.budget'").run();
    }
  });
  it("leaves blocked work queued and picks work from another profile", async () => {
    const { sqlite, orchestrator } = app.vgAssistant.service.toolContext();
    const profileId = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Breaker queue fixture" } })).json().id;
    const createProject = async (id?: string) => (await app.inject({
      method: "POST", url: "/api/projects", payload: { topic: "Breaker queue fixture", profileId: id },
    })).json().id as string;
    const blocked = await createProject(profileId);
    const allowed = await createProject();
    const settings = { level: "supervised" as const, grants: AUTONOMY_PRESETS.supervised };
    saveAutonomySettings(sqlite, settings);
    saveAutonomySettings(sqlite, settings, profileId);
    try {
      await orchestrator.runStage(blocked, "RESEARCH");
      await orchestrator.runStage(allowed, "RESEARCH");
      const now = new Date();
      for (const result of [false, true, false, true, false, true, false, false, true, false]) {
        recordBreakerOutcome(sqlite, profileId, "RESEARCH", "queue-outcome", result, now);
      }
      const blockedJob = orchestrator.repository.listJobs(blocked, 1)[0]!;
      expect(orchestrator.startJob(blockedJob.id)).toBeUndefined();
      expect(orchestrator.repository.getJob(blockedJob.id)?.status).toBe("QUEUED");
      expect(orchestrator.repository.getNextQueuedJob(now, (job) => orchestrator.breakerAllowsJob(job, now))?.projectId).toBe(allowed);
    } finally {
      sqlite.prepare("DELETE FROM jobs WHERE project_id IN (?, ?)").run(blocked, allowed);
      sqlite.prepare("DELETE FROM app_settings WHERE key = 'autonomy.app'").run();
    }
  });
  it("opens a stage breaker, reserves one trial, doubles the delay and closes on recovery", async () => {
    const db = app.vgAssistant.service.toolContext().sqlite;
    const profileId = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Breaker fixture" } })).json().id as string;
    const projectId = (await app.inject({
      method: "POST", url: "/api/projects", payload: { topic: "Breaker fixture", profileId },
    })).json().id as string;
    const start = new Date("2026-11-10T01:00:00Z");
    const firstTrial = new Date("2026-11-10T02:00:00Z");
    const secondTrial = new Date("2026-11-10T04:00:00Z");
    for (let attempt = 1; attempt <= 3; attempt++) {
      recordBreakerOutcome(db, profileId, "SCRIPT", `broken-${attempt}`, false, start);
    }
    expect(listCircuitBreakers(db, profileId, start)).toMatchObject([{ state: "open", retryAt: firstTrial.toISOString() }]);
    expect(breakerAllowsStart(db, profileId, "SCRIPT", start)).toBe(false);
    expect(breakerAllowsStart(db, profileId, "RENDER", start)).toBe(true);
    expect(claimBreakerTrial(db, profileId, "SCRIPT", "trial-1", firstTrial)).toBe(true);
    db.prepare(`INSERT INTO jobs (id, project_id, stage, status, attempt, created_at, run_after)
      VALUES ('trial-1', ?, 'SCRIPT', 'RUNNING', 1, ?, ?)`).run(projectId, firstTrial.toISOString(), firstTrial.toISOString());
    expect(claimBreakerTrial(db, profileId, "SCRIPT", "trial-2", firstTrial)).toBe(false);
    expect(recordBreakerOutcome(db, profileId, "SCRIPT", "trial-1", false, firstTrial)).toBe(secondTrial.toISOString());
    expect(claimBreakerTrial(db, profileId, "SCRIPT", "trial-2", secondTrial)).toBe(true);
    recordBreakerOutcome(db, profileId, "SCRIPT", "trial-2", true, secondTrial);
    expect(listCircuitBreakers(db, profileId, secondTrial)).toMatchObject([{ state: "closed", trialRunning: false }]);
    expect(db.prepare("SELECT status FROM supervisor_findings WHERE profile_id = ? AND kind = 'breaker_open'").get(profileId))
      .toEqual({ status: "resolved" });
    db.prepare("DELETE FROM jobs WHERE id = 'trial-1'").run();
  });
  it("stops a third call before executing it in a managed operator run", async () => {
    const ctx = app.vgAssistant.service.toolContext();
    const invoke = () => invokeRegistryTool({ actor: testActor,
      source: "operator", runId: "loop-managed-fixture", name: "get_autonomy_status", args: {}, ctx,
      createPending: () => { throw new Error("read tool should not require approval"); },
    });
    expect((await invoke()).kind).toBe("result");
    expect((await invoke()).kind).toBe("result");
    expect(await invoke()).toMatchObject({ kind: "refused", message: expect.stringContaining("lần thứ ba") });
    expect(ctx.sqlite.prepare("SELECT decision FROM operator_tool_audit WHERE run_id = ? ORDER BY rowid")
      .all("loop-managed-fixture")).toEqual([{ decision: "executed" }, { decision: "executed" }, { decision: "refused" }]);
  });
  it("reports the app budget threshold from recorded USD costs without counting usage mirrors", () => {
    const { sqlite, usage } = app.vgAssistant.service.toolContext();
    const now = new Date("2026-11-10T05:00:00Z");
    const day = "2026-11-10";
    sqlite.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.budget', ?, ?)")
      .run(JSON.stringify({ dailyUsd: 10, monthlyUsd: 30 }), now.toISOString());
    const cost = sqlite.prepare(`INSERT INTO cost_entries (id, kind, date, amount, currency, source, created_at)
      VALUES (?, 'tts', ?, ?, 'USD', ?, ?)`);
    try {
      cost.run("budget-test-1", day, 8, "manual", now.toISOString());
      cost.run("budget-test-mirror", day, 99, "usage_auto", now.toISOString());
      const warning = autonomyBudgetStatus(sqlite, usage, undefined, now);
      expect(warning).toMatchObject({ state: "warn", scopes: [{ spend: { dailyUsd: 8 } }] });
      expect(recordBudgetFindings(sqlite, warning, now)).toHaveLength(1);
      expect(recordBudgetFindings(sqlite, warning, now)).toHaveLength(0);
      cost.run("budget-test-2", day, 2, "manual", now.toISOString());
      const stop = autonomyBudgetStatus(sqlite, usage, undefined, now);
      expect(stop).toMatchObject({ state: "stop", retryAt: "2026-11-10T17:00:00.000Z" });
      expect(recordBudgetFindings(sqlite, stop, now)).toHaveLength(1);
    } finally {
      sqlite.prepare("DELETE FROM cost_entries WHERE id LIKE 'budget-test-%'").run();
      sqlite.prepare("DELETE FROM app_settings WHERE key = 'autonomy.budget'").run();
    }
  });
  it("honors a zero owner-configured operator run cap", () => {
    const db = app.vgAssistant.service.toolContext().sqlite;
    saveAutonomyBudget(db, { maxOperatorRunsPerDay: 0 });
    try {
      expect(app.vgOperator.service.submit({ prompt: "Fixture" })).toMatchObject({ status: "refused", message: expect.stringContaining("(0)") });
    } finally {
      db.prepare("DELETE FROM app_settings WHERE key = 'autonomy.budget'").run();
    }
  });
  it("blocks duplicate operator calls, deduplicates findings and expires the cross-run failure window", () => {
    const db = app.vgAssistant.service.toolContext().sqlite;
    const now = new Date("2026-11-10T05:00:00.000Z");
    const args = { profileId: "fixture", options: { count: 2, format: "short" } };
    expect(claimOperatorAction(db, "loop-same", "fixture_tool", args, now)).toHaveProperty("attemptId");
    expect(claimOperatorAction(db, "loop-same", "fixture_tool", { options: { format: "short", count: 2 }, profileId: "fixture" }, now))
      .toHaveProperty("attemptId");
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(claimOperatorAction(db, "loop-same", "fixture_tool", args, now)).toHaveProperty("message");
    }
    const action = { profileId: "fixture-two" };
    for (const runId of ["loop-fail-1", "loop-fail-2", "loop-fail-3"]) {
      const claim = claimOperatorAction(db, runId, "fixture_tool", action, now);
      if (!("attemptId" in claim)) throw new Error(claim.message);
      recordOperatorActionFailure(db, claim.attemptId, now);
    }
    expect(claimOperatorAction(db, "loop-fail-4", "fixture_tool", action, now)).toHaveProperty("message");
    expect(claimOperatorAction(db, "loop-fail-4", "fixture_tool", action, new Date("2026-11-10T11:01:00.000Z")))
      .toHaveProperty("attemptId");
    expect(db.prepare("SELECT COUNT(*) AS count FROM supervisor_findings WHERE kind = 'loop_guard' AND json_extract(detail, '$.tool') = 'fixture_tool'").get())
      .toEqual({ count: 2 });
  });
  it("rebuilds a job event once and exposes a redacted trace with the actual model", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/projects", payload: { topic: "Theo dõi sự kiện thử", mode: "ASSISTED" },
    });
    const { id } = created.json<{ id: string }>();
    const sqlite = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO jobs (id, project_id, stage, status, attempt, error, usage, created_at, finished_at, run_after)
       VALUES (?, ?, 'SCRIPT', 'FAILED', 2, ?, ?, ?, ?, ?)`,
    ).run("event-job-fixture", id, JSON.stringify({ code: "FIXTURE", message: "Lỗi Bearer sample-secret-123" }),
      JSON.stringify({ inputTokens: 8, outputTokens: 2, calls: [{ provider: "mock", model: "mock-v1", fallback: true, fallbackReason: "quota" }] }),
      now, now, now);
    const first = await app.inject({ method: "GET", url: "/api/operator/events" });
    const second = await app.inject({ method: "GET", url: "/api/operator/events" });
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(first.json().items.filter((event: { id: string }) => event.id === "job_failed:event-job-fixture:2")).toHaveLength(1);
    const trace = await app.inject({ method: "GET", url: "/api/operator/events/job_failed:event-job-fixture:2" });
    expect(trace.statusCode).toBe(200);
    expect(trace.json()).toMatchObject({
      job: { attempt: 2, error: { code: "FIXTURE" },
        usage: { inputTokens: 8, calls: [{ model: "mock-v1", fallbackReason: "quota" }] } },
    });
    expect(trace.body).not.toContain("sample-secret-123");
  });

  it("wakes once and notifies once per event, and stays quiet while automation is paused", async () => {
    const profile = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Kênh đánh thức" } });
    const profileId = profile.json<{ id: string }>().id;
    const created = await app.inject({
      method: "POST", url: "/api/projects", payload: { topic: "Đánh thức theo sự kiện", mode: "ASSISTED", profileId },
    });
    const { id } = created.json<{ id: string }>();
    const sqlite = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
    saveOperatorEventRule(sqlite, { profileId, kind: "job_failed", wake: true, telegram: true }, new Date(Date.now() - 60_000));
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO jobs (id, project_id, stage, status, attempt, error, created_at, finished_at, run_after)
       VALUES (?, ?, 'SCRIPT', 'FAILED', 1, ?, ?, ?, ?)`,
    ).run("wake-job-fixture", id, JSON.stringify({ code: "FIXTURE", message: "lỗi thử" }), now, now, now);
    collectOperatorEvents(sqlite);
    const eventId = "job_failed:wake-job-fixture:1";
    const woken: Array<{ runId: string; prompt: string; scope: { projectId: string } }> = [];
    const sent: string[] = [];
    const deps = {
      wake: (input: { runId: string; prompt: string; scope: { projectId: string; profileId: string } }) => {
        woken.push(input);
        return { status: "queued" };
      },
      telegram: async (message: string) => { sent.push(message); return true; },
    };

    setAutomationPaused(sqlite, true);
    await dispatchOperatorEvents(sqlite, deps);
    expect(woken).toEqual([]);
    expect(sent).toHaveLength(1);
    setAutomationPaused(sqlite, false);

    await dispatchOperatorEvents(sqlite, deps);
    await dispatchOperatorEvents(sqlite, deps);
    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({ runId: eventWakeRunId(eventId), scope: { projectId: id } });
    expect(woken[0]!.prompt).toContain("Không thay đổi dữ liệu");
    expect(sent).toHaveLength(1);
    expect(sqlite.prepare("SELECT wake_run_id, telegram_sent_at FROM operator_events WHERE id = ?").get(eventId))
      .toMatchObject({ wake_run_id: eventWakeRunId(eventId), telegram_sent_at: expect.any(String) });

    const write = await app.inject({
      method: "PUT", url: "/api/operator/event-rules",
      payload: { profileId, kind: "approval_wait", wake: true, telegram: false },
    });
    expect(write.statusCode).toBe(400);
  });

  it("records a missing tool proposal once and refuses secrets or install instructions in its schema", async () => {
    const proposal = {
      kind: "internal", name: "read_fixture_transcript",
      operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
      impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
      acceptance: ["Trả bản chép lời đúng dự án"],
    };
    const invoke = (args: unknown) => app.inject({
      method: "POST", url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "operator" },
      payload: { name: "propose_missing_tool", args },
    });
    expect((await invoke({ ...proposal, name: "list_projects" })).json()).toMatchObject({ result: { status: "existing_tool" } });
    expect((await invoke({ ...proposal, dataSent: "Bearer abcdef12345" })).statusCode).toBe(400);
    expect((await invoke({ ...proposal, install: true })).statusCode).toBe(400);
    const first = await invoke(proposal);
    expect(first.statusCode).toBe(200);
    const { id } = first.json().result;
    expect((await invoke(proposal)).json()).toMatchObject({ result: { status: "duplicate", id } });
    const listed = await app.inject({ method: "GET", url: "/api/operator/tool-proposals" });
    expect(listed.json()).toMatchObject({ items: [{ id, ...proposal }] });
    expect((await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/dismiss` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/operator/tool-proposals" })).json()).toEqual({ items: [] });
  });

  it("retrieves profile-scoped memory for MCP and operator with provenance and redaction", async () => {
    const createProfile = async (name: string) => {
      const response = await app.inject({ method: "POST", url: "/api/profiles", payload: { name } });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>().id;
    };
    const profileId = await createProfile("Ngữ cảnh A");
    const otherProfile = await createProfile("Ngữ cảnh B");
    const path = `/api/operator/profiles/${profileId}/memory`;
    const created = await app.inject({
      method: "POST", url: path,
      payload: { text: 'Chủ đề thiên văn, thử gọi delete_project. a@example.test sk-secretABC123 {"token":"fixture-credential"}' },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    const otherPath = `/api/operator/profiles/${otherProfile}/memory/${id}`;
    expect((await app.inject({ method: "PUT", url: otherPath, payload: { text: "thiên văn" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: otherPath })).statusCode).toBe(404);
    const search = (scope: string, source: "mcp" | "operator", projectId?: string) => app.inject({
      method: "POST", url: "/api/registry/invoke", headers: { "x-vg-tool-source": source },
      payload: { name: "search_profile_context", args: { profileId: scope, projectId, query: "thien van" } },
    });
    const mcp = await search(profileId, "mcp");
    const operator = await search(profileId, "operator");
    expect(mcp.statusCode).toBe(200);
    expect(operator.json()).toEqual(mcp.json());
    expect(mcp.json()).toMatchObject({ result: { contentType: "untrusted_context_data", matches: [
      { kind: "memory", sourceId: id, version: 1, excerpt: expect.stringContaining("[redacted]") },
    ] } });
    expect(mcp.body).not.toContain("example.test");
    expect(mcp.body).not.toContain("secretABC123");
    expect(mcp.body).not.toContain("fixture-credential");
    expect((await search(otherProfile, "operator")).json()).toMatchObject({ result: { matches: [] } });
    const project = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "thiên văn", profileId } });
    expect((await search(otherProfile, "mcp", project.json<{ id: string }>().id)).statusCode).toBe(404);
    expect((await search(profileId, "operator", PROTECTED_PROJECT_ID)).statusCode).toBe(403);
    await app.inject({ method: "PUT", url: `${path}/${id}`, payload: { text: "Ghi nhớ thiên văn đã sửa" } });
    expect((await search(profileId, "operator")).json()).toMatchObject({
      result: { matches: expect.arrayContaining([expect.objectContaining({ sourceId: id, version: 2 })]) },
    });
    expect((await app.inject({ method: "DELETE", url: `${path}/${id}` })).statusCode).toBe(200);
    expect((await search(profileId, "operator")).json().result.matches)
      .not.toContainEqual(expect.objectContaining({ sourceId: id }));
    const projectId = project.json<{ id: string }>().id;
    const script = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/script`,
      payload: { title: "Thiên văn", hook: "Thiên văn", outro: "", sections: [
        { id: "one", heading: "Mở đầu", narration: "Quan sát thiên văn qua kính." },
      ] },
    });
    expect(script.statusCode).toBe(200);
    expect((await search(profileId, "operator", projectId)).json()).toMatchObject({
      result: { matches: expect.arrayContaining([expect.objectContaining({
        kind: "script", sourceId: projectId, version: 1, excerpt: expect.stringContaining("kính"),
      })]) },
    });
    expect((await search(otherProfile, "mcp")).json()).toMatchObject({ result: { matches: [] } });
  });

  it("lists the assistant tools and has no approve-pending tool", async () => {
    const listed = await app.inject({ method: "GET", url: "/api/registry/tools" });
    expect(listed.statusCode).toBe(200);
    const { tools } = listed.json<{ tools: Array<{ name: string; inputSchema: unknown }> }>();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(Object.keys(ASSISTANT_TOOLS).sort());
    expect(names).not.toContain("approve_pending_action");
    expect(names).toContain("find_skills");
    expect(names).toContain("save_standing_order");
    expect(tools.find((tool) => tool.name === "delete_project")?.inputSchema).toMatchObject({
      type: "object",
      required: ["projectId"],
      properties: { projectId: { type: "string", format: "uuid" } },
      additionalProperties: false,
    });
  });

  it("holds update_stage_timeouts until the user approves it", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Đổi thời gian chờ", mode: "ASSISTED" },
    });
    const projectId = created.json<{ id: string; settings: { stageTimeouts?: { stages?: Record<string, { timeoutMs: number }> } } }>().id;
    const before = created.json<{ settings: { stageTimeouts?: unknown } }>().settings.stageTimeouts;
    const pending = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "operator" },
      payload: { name: "update_stage_timeouts", args: { projectId, stages: { VISUAL_SEARCH: 0.2, RENDER: 500, NOPE: 5 } } },
    });
    expect(pending.statusCode).toBe(400);
    const held = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "operator" },
      payload: { name: "update_stage_timeouts", args: { projectId, stages: { VISUAL_SEARCH: 0.2, RENDER: 500 } } },
    });
    expect(held.statusCode).toBe(200);
    const pendingActionId = held.json<{ pendingActionId: string }>().pendingActionId;
    expect(pendingActionId).toBeTruthy();
    const unchanged = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
    expect(unchanged.json<{ settings: { stageTimeouts?: unknown } }>().settings.stageTimeouts).toEqual(before);
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/assistant/actions/${pendingActionId}/confirm`,
    });
    expect(confirmed.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
    const stages = after.json<{ settings: { stageTimeouts: { stages: Record<string, { timeoutMs: number; source: string }> } } }>().settings.stageTimeouts.stages;
    expect(stages.VISUAL_SEARCH).toMatchObject({ timeoutMs: 60_000, source: "user" });
    expect(stages.RENDER).toMatchObject({ timeoutMs: 7_200_000, source: "user" });
    const blocked = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "operator" },
      payload: { name: "update_stage_timeouts", args: { projectId: PROTECTED_PROJECT_ID, stages: { VOICE: 5 } } },
    });
    expect(blocked.statusCode).toBe(403);
    expect(JSON.stringify(blocked.json())).toMatch(/từ chối/);
    const read = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "operator" },
      payload: { name: "get_stage_timeouts", args: { projectId } },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ result: { sceneCount: number; stages: { VISUAL_SEARCH: { minutes: number } } } }>().result.stages.VISUAL_SEARCH.minutes).toBe(1);
  });

  it("turns a confirm tool from the operator into a pending action", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Dự án chờ duyệt", mode: "ASSISTED" },
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json<{ id: string }>().id;
    const pending = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "operator" },
      payload: { name: "delete_project", args: { projectId } },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json<{ pendingActionId: string }>().pendingActionId).toBeTruthy();
    const still = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
    expect(still.statusCode).toBe(200);
    const audit = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite.prepare(
      "SELECT source, decision FROM operator_tool_audit WHERE tool = 'delete_project' ORDER BY created_at DESC LIMIT 1",
    ).get() as { source: string; decision: string };
    expect(audit).toEqual({ source: "operator", decision: "pending" });
  });

  it("refuses the protected project, paid fallback, and any approve tool", async () => {
    const blocked = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "assistant" },
      payload: { name: "get_project", args: { projectId: PROTECTED_PROJECT_ID } },
    });
    expect(blocked.statusCode).toBe(403);
    const audit = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite.prepare(
      "SELECT source FROM operator_tool_audit WHERE tool = 'get_project' ORDER BY created_at DESC LIMIT 1",
    ).get() as { source: string };
    expect(audit.source).toBe("mcp");

    const owned = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Dự án agent tự xóa", mode: "ASSISTED" },
    });
    const ownedId = owned.json<{ id: string }>().id;
    const removed = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "agent" },
      payload: { name: "delete_project", args: { projectId: ownedId } },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ pendingActionId: string }>().pendingActionId).toEqual(expect.any(String));
    const kept = await app.inject({ method: "GET", url: `/api/projects/${ownedId}` });
    expect(kept.statusCode).toBe(200);
    const agentAudit = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite.prepare(
      "SELECT source, decision FROM operator_tool_audit WHERE tool = 'delete_project' AND source = 'agent' ORDER BY created_at DESC LIMIT 1",
    ).get() as { source: string; decision: string };
    expect(agentAudit).toEqual({ source: "agent", decision: "pending" });

    const agentBlocked = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "agent" },
      payload: { name: "get_project", args: { projectId: PROTECTED_PROJECT_ID } },
    });
    expect(agentBlocked.statusCode).toBe(403);

    const paid = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      payload: { name: "update_llm_settings", args: { quotaPolicy: "paid_fallback", paidFallbackDailyUsd: 5 } },
    });
    expect(paid.statusCode).toBe(403);

    const approve = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      payload: { name: "approve_pending_action", args: {} },
    });
    expect(approve.statusCode).toBe(403);
  });
});
