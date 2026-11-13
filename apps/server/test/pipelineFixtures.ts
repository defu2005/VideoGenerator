import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { JobWorker } from "../src/jobs/worker.js";
import { createExecutorRegistry } from "../src/pipeline/executorRegistry.js";
import type { FakeFailure } from "../src/pipeline/fakeExecutor.js";
import { PipelineOrchestrator, type ApprovalCheck } from "../src/pipeline/orchestrator.js";
import type { PipelineStage, Project } from "@vg/shared";

type HarnessOptions = {
  config?: Partial<AppConfig>;
  failures?: Partial<Record<PipelineStage, FakeFailure>>;
  mode?: "AUTO" | "ASSISTED" | "MANUAL";
  autoRender?: boolean;
  canApprove?: ApprovalCheck;
  autoBlock?: (project: Project, gate: PipelineStage) => string | null;
};

export function createPipelineHarness(options: HarnessOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "vg-pipeline-test-"));
  let timestamp = new Date("2026-11-03T00:00:00.000Z");
  const clock = () => new Date(timestamp);
  const config = {
    ...parseConfig({
      DATA_DIR: join(root, "data"),
      DATABASE_PATH: join(root, "app.db"),
      WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
    }),
    ...options.config,
  };
  const database = openDatabase(config.DATABASE_PATH);
  migrateDatabase(database.db);
  const events = new PipelineEventBus();
  const repository = new JobRepository(database.sqlite, events, clock);
  const logger = Fastify({ logger: { level: "silent" } }).log;
  const orchestrator = new PipelineOrchestrator(repository, config, logger, clock, options.canApprove, options.autoBlock);
  const executors = createExecutorRegistry({ delayMs: config.FAKE_STAGE_DELAY_MS, failures: options.failures });
  const worker = new JobWorker(
    repository,
    orchestrator,
    executors,
    config,
    logger,
    clock,
  );
  const projectId = randomUUID();
  const createdAt = timestamp.toISOString();
  database.sqlite.prepare(
    "INSERT INTO projects (id, title, description, topic, mode, settings, status, stage, thumbnail_path, duration_sec, version, created_at, updated_at, archived_at, run_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    projectId,
    "Pipeline test",
    "",
    "Testing pipeline behavior",
    options.mode ?? "ASSISTED",
    JSON.stringify({
      language: "en",
      targetDurationSec: 120,
      aspectRatio: "16:9",
      // The app default is compose. These fixtures pin the classic path.
      edit: { engine: "legacy" },
      stageExecutors: {},
      autoRender: options.autoRender ?? false,
    }),
    "DRAFT",
    "TOPIC",
    null,
    null,
    1,
    createdAt,
    createdAt,
    null,
    null,
  );

  return {
    config,
    sqlite: database.sqlite,
    repository,
    events,
    orchestrator,
    worker,
    executors,
    projectId,
    clock,
    setNow(value: Date) { timestamp = new Date(value); },
    advance(ms: number) { timestamp = new Date(timestamp.getTime() + ms); },
    close() {
      if (!database.sqlite.open) return;
      database.sqlite.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function drainUntilGate(harness: ReturnType<typeof createPipelineHarness>): Promise<void> {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const state = harness.orchestrator.getPipeline(harness.projectId);
    if (state.stages.some((stage) => stage.state === "WAITING_USER")) return;
    if (!state.activeJob || state.activeJob.status !== "QUEUED") return;
    await harness.worker.tick();
  }
}
