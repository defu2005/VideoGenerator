import { afterEach, describe, expect, it } from "vitest";
import { listOverdueChecks, readOverdueMark } from "../src/jobs/overdueStore.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function makeHarness(onOverdue: "check" | "abort" | "notify_only") {
  const harness = createPipelineHarness({
    failures: { RESEARCH: "hang" },
    config: { STAGE_TIMEOUT_MS: 600_000, JOB_MAX_ATTEMPTS: 2, JOB_RETRY_BASE_MS: 0 },
  });
  harnesses.push(harness);
  const project = harness.repository.getProject(harness.projectId)!;
  harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify({
    ...project.settings,
    onOverdue,
    stageTimeouts: {
      source: "mixed",
      inputHash: "test",
      summary: "test",
      stages: { RESEARCH: { timeoutMs: 10, reason: "test", source: "user" } },
    },
  }), harness.projectId);
  const notices: string[] = [];
  harness.worker.setOverdue({
    sqlite: harness.sqlite,
    now: () => new Date(),
    notify: (_job, message) => { notices.push(message); },
  });
  return { harness, notices };
}

async function until(check: () => boolean, ms = 4_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("worker soft time limit", () => {
  it("keeps a stage running past its limit and lets a decision abort and retry it", async () => {
    const { harness } = makeHarness("check");
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    const running = harness.worker.tick();
    const job = harness.repository.getActiveJob(harness.projectId)!;
    await until(() => readOverdueMark(harness.sqlite, job.id) !== null);
    expect(harness.repository.getActiveJob(harness.projectId)?.status).toBe("RUNNING");
    await until(() => listOverdueChecks(harness.sqlite, job.id).length > 0);

    const result = harness.orchestrator.decideOverdue(job.id, {
      action: "abort_retry", reason: "Không có dấu hiệu làm việc, thử lại.", source: "user", actor: "user",
    });
    expect(result.ok).toBe(true);
    await running;
    const next = harness.repository.getActiveJob(harness.projectId);
    expect(next?.attempt).toBe(2);
    expect(readOverdueMark(harness.sqlite, job.id)).toBeNull();
    expect(listOverdueChecks(harness.sqlite, job.id).at(-1)).toMatchObject({ action: "abort_retry", source: "user" });
  });

  it("abort_fail ends the job with a non-retryable error", async () => {
    const { harness } = makeHarness("check");
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    const running = harness.worker.tick();
    const job = harness.repository.getActiveJob(harness.projectId)!;
    await until(() => readOverdueMark(harness.sqlite, job.id) !== null);
    expect(harness.orchestrator.decideOverdue(job.id, {
      action: "abort_fail", reason: "Đầu vào hỏng, thử lại cũng vô ích.", source: "hermes", actor: "hermes",
    }).ok).toBe(true);
    await running;
    const stage = harness.repository.getStage(harness.projectId, "RESEARCH");
    expect(stage.state).toBe("FAILED");
    expect(stage.error?.code).toBe("STAGE_OVERDUE_ABORTED");
    expect(stage.error?.retryable).toBe(false);
  });

  it("refuses a decision for a job that is not overdue", () => {
    const { harness } = makeHarness("check");
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    const job = harness.repository.getActiveJob(harness.projectId)!;
    expect(harness.orchestrator.decideOverdue(job.id, {
      action: "wait", reason: "Không còn quá giờ nữa.", source: "user", actor: "user",
    }).ok).toBe(false);
  });

  it("onOverdue abort keeps the old behaviour: the stage is killed at the limit", async () => {
    const { harness } = makeHarness("abort");
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await harness.worker.tick();
    const job = harness.repository.listJobs(harness.projectId, 1)[0]!;
    expect(readOverdueMark(harness.sqlite, job.id)).toBeNull();
    expect(listOverdueChecks(harness.sqlite, job.id)).toHaveLength(0);
    await harness.worker.tick();
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").error?.code).toBe("STAGE_TIMEOUT");
  }, 15_000);
});
