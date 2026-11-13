import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERDUE_NOTICE_AFTER_MS, PROTECTED_PROJECT_ID } from "@vg/shared";
import { ActivityTracker, OverdueRun, type OverdueAbortKind, type OverdueDeps } from "../src/jobs/overdueRun.js";
import { getOverdueJob, listOverdueChecks, readOverdueMark } from "../src/jobs/overdueStore.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const MIN = 60_000;
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-13T00:00:00.000Z") }); });
afterEach(() => {
  vi.useRealTimers();
  for (const harness of harnesses.splice(0)) harness.close();
});

function setup(options: { onOverdue?: "check" | "abort" | "notify_only"; chooser?: OverdueDeps["chooser"]; projectId?: string } = {}) {
  const harness = createPipelineHarness({ config: { FAKE_STAGE_DELAY_MS: 0 } });
  harnesses.push(harness);
  harness.orchestrator.runStage(harness.projectId, "RESEARCH");
  const queued = harness.repository.getActiveJob(harness.projectId)!;
  harness.sqlite.prepare("UPDATE jobs SET status = 'RUNNING', started_at = ? WHERE id = ?").run(new Date().toISOString(), queued.id);
  const job = harness.repository.getActiveJob(harness.projectId)!;
  const project = harness.repository.getProject(harness.projectId)!;
  const notices: string[] = [];
  const aborts: Array<{ kind: OverdueAbortKind; reason: string }> = [];
  const startedAtMs = Date.now();
  const tracker = new ActivityTracker(startedAtMs);
  const run = new OverdueRun({
    deps: {
      sqlite: harness.sqlite,
      now: () => new Date(),
      notify: (_job, message) => { notices.push(message); },
      chooser: options.chooser,
    },
    job: options.projectId ? { ...job, projectId: options.projectId } : job,
    project,
    onOverdue: options.onOverdue ?? "check",
    tracker,
    startedAtMs,
    expectedMs: 5 * MIN,
    limitMs: 10 * MIN,
    maxAttempts: 3,
    historyNote: null,
    remote: false,
    abort: (kind, reason) => { aborts.push({ kind, reason }); },
  });
  return { harness, job, run, tracker, notices, aborts };
}

describe("OverdueRun", () => {
  it("marks the job overdue, checks at once, and never aborts by itself", async () => {
    const { harness, job, run, aborts } = setup();
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(readOverdueMark(harness.sqlite, job.id)?.state).toBe("waiting_decision");
    expect(listOverdueChecks(harness.sqlite, job.id)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3 * 60 * MIN);
    expect(aborts).toEqual([]);
    expect(listOverdueChecks(harness.sqlite, job.id).length).toBeGreaterThan(3);
    run.stop();
  });

  it("waits while the work signals are moving", async () => {
    const { harness, job, run, tracker } = setup();
    tracker.note(60, "đang dựng", Date.now());
    tracker.note(75, "đang dựng", Date.now());
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    const [first] = listOverdueChecks(harness.sqlite, job.id);
    expect(first?.action).toBe("wait");
    expect(first?.source).toBe("ladder");
    expect(readOverdueMark(harness.sqlite, job.id)?.state).toBe("checking");
    run.stop();
  });

  it("spaces checks 2, 5, 10 minutes apart", async () => {
    const { harness, job, run } = setup();
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(listOverdueChecks(harness.sqlite, job.id).map((row) => row.checkNo)).toEqual([1, 2, 3]);
    run.stop();
  });

  it("lets a model wait, and overrides a wait that has no signal for 10 minutes", async () => {
    const chooser = vi.fn(async () => ({ action: "wait", reason: "Có vẻ vẫn đang chạy." }));
    const { harness, job, run } = setup({ chooser });
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listOverdueChecks(harness.sqlite, job.id)[0]).toMatchObject({ action: "wait", source: "llm" });
    await vi.advanceTimersByTimeAsync(12 * MIN);
    const later = listOverdueChecks(harness.sqlite, job.id).filter((row) => row.action === "escalate");
    expect(later.length).toBeGreaterThan(0);
    expect(later[0]?.source).toBe("override");
    run.stop();
  });

  it("falls back to the ladder when the model returns garbage", async () => {
    const { harness, job, run } = setup({ chooser: async () => ({ action: "abort" }) });
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listOverdueChecks(harness.sqlite, job.id)[0]?.source).toBe("ladder");
    run.stop();
  });

  it("notify_only never calls the model and tells the user at the first escalate", async () => {
    const chooser = vi.fn(async () => ({ action: "wait", reason: "x" }));
    const { run, notices } = setup({ onOverdue: "notify_only", chooser });
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(chooser).not.toHaveBeenCalled();
    expect(notices).toHaveLength(1);
    run.stop();
  });

  it("sends one notice after 30 minutes without a decision, at most every 2 hours", async () => {
    const { run, notices } = setup();
    run.start();
    await vi.advanceTimersByTimeAsync(OVERDUE_NOTICE_AFTER_MS + MIN);
    expect(notices).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(notices).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(80 * MIN);
    expect(notices.length).toBeLessThanOrEqual(2);
    run.stop();
  });

  it("decide: wait clamps extendMs and goes back to checking", async () => {
    const { harness, job, run } = setup();
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    const result = run.decide({ action: "wait", reason: "Render còn chạy bình thường.", extendMs: 1_000, source: "hermes", actor: "hermes" });
    expect(result.ok).toBe(true);
    const row = listOverdueChecks(harness.sqlite, job.id).at(-1)!;
    expect(row).toMatchObject({ action: "wait", source: "hermes", actor: "hermes" });
    expect(row.extendMs).toBe(5 * MIN);
    expect(readOverdueMark(harness.sqlite, job.id)?.state).toBe("checking");
    const big = run.decide({ action: "wait", reason: "Chờ thêm thật lâu.", extendMs: 999 * MIN, source: "user", actor: "user" });
    expect(big.ok).toBe(true);
    expect(listOverdueChecks(harness.sqlite, job.id).at(-1)?.extendMs).toBe(20 * MIN);
    run.stop();
  });

  it("decide: abort stops the run and calls the worker, once", async () => {
    const { harness, job, run, aborts } = setup();
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    const result = run.decide({ action: "abort_retry", reason: "Không có dấu hiệu làm việc 20 phút.", source: "user", actor: "user" });
    expect(result.ok).toBe(true);
    expect(aborts).toEqual([{ kind: "abort_retry", reason: "Không có dấu hiệu làm việc 20 phút." }]);
    expect(listOverdueChecks(harness.sqlite, job.id).at(-1)).toMatchObject({ action: "abort_retry", source: "user" });
    const again = run.decide({ action: "abort_fail", reason: "Dừng hẳn lần nữa.", source: "hermes", actor: "hermes" });
    expect(again.ok).toBe(false);
    expect(aborts).toHaveLength(1);
  });

  it("decide: the protected project refuses aborts but allows wait and ask_user", async () => {
    const { run, aborts } = setup({ projectId: PROTECTED_PROJECT_ID });
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.decide({ action: "abort_retry", reason: "Thử dừng dự án được bảo vệ.", source: "hermes", actor: "hermes" }).ok).toBe(false);
    expect(run.decide({ action: "abort_fail", reason: "Thử dừng hẳn dự án bảo vệ.", source: "user", actor: "user" }).ok).toBe(false);
    expect(aborts).toEqual([]);
    expect(run.decide({ action: "ask_user", reason: "Cần người xem.", source: "hermes", actor: "hermes" }).ok).toBe(true);
    expect(run.decide({ action: "wait", reason: "Chờ thêm một chút.", source: "hermes", actor: "hermes" }).ok).toBe(true);
    run.stop();
  });

  it("refuses a decision after the run stopped", async () => {
    const { harness, job, run } = setup();
    run.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getOverdueJob(harness.sqlite, job.id)?.jobId).toBe(job.id);
    run.stop();
    expect(run.decide({ action: "wait", reason: "Quyết định sau khi dừng.", source: "hermes", actor: "hermes" }).ok).toBe(false);
  });
});
