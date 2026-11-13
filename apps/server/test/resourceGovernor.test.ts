import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTONOMY_PRESETS, PROTECTED_PROJECT_ID } from "@vg/shared";
import {
  ResourceGovernor, defaultGovernorSettings, readGovernorSettings, stageClassOf, writeGovernorSettings,
  type LoadSample, type LoadSampler,
} from "../src/jobs/resourceGovernor.js";
import { saveAutonomySettings } from "../src/operator/autonomy.js";
import { AutonomySupervisor, listSupervisorState } from "../src/operator/supervisor.js";
import { UsageService } from "../src/services/usageService.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const harness = createPipelineHarness(options);
  harnesses.push(harness);
  return harness;
}
afterEach(() => {
  vi.useRealTimers();
  for (const harness of harnesses.splice(0)) harness.close();
});

type Harness = ReturnType<typeof createPipelineHarness>;
type Cls = "cpu" | "gpu" | "io" | "llm";

const CALM: LoadSample = { cpuPct: 20, ramPct: 40, diskFreeBytes: 200 * 1024 ** 3, gpuPct: null };
function fakeSampler(initial: LoadSample = CALM) {
  const state = { sample: { ...initial } };
  const sampler: LoadSampler = () => ({ ...state.sample });
  return { state, sampler };
}
function build(harness: Harness, extra: Partial<ConstructorParameters<typeof ResourceGovernor>[0]> = {}) {
  const load = fakeSampler();
  const governor = new ResourceGovernor({
    sqlite: harness.sqlite, sampler: load.sampler, workerCap: 12, cores: 8, now: harness.clock, ...extra,
  });
  return { governor, load };
}
let acquired = 0;
function saturate(governor: ResourceGovernor, cls: Cls, n: number) {
  for (let i = 0; i < n; i += 1) {
    acquired += 1;
    governor.acquire(`fake-${acquired}`, cls);
  }
}
function fill(governor: ResourceGovernor, cls: Cls) {
  saturate(governor, cls, Math.max(0, governor.limitOf(cls) - governor.runningIn(cls)));
}

describe("resource governor: classes and settings", () => {
  it("maps stages to classes", () => {
    expect(stageClassOf("RENDER")).toBe("cpu");
    expect(stageClassOf("SCRIPT")).toBe("llm");
    expect(stageClassOf("MEDIA_FETCH")).toBe("io");
    expect(stageClassOf("VOICE", "gpu")).toBe("gpu");
  });

  it("stores per-class min/max and falls back to defaults", () => {
    const harness = makeHarness();
    expect(readGovernorSettings(harness.sqlite, 8)).toEqual(defaultGovernorSettings(8));
    writeGovernorSettings(harness.sqlite, { enabled: false, classes: { io: { min: 1, max: 4 } } }, harness.clock(), 8);
    const saved = readGovernorSettings(harness.sqlite, 8);
    expect(saved.enabled).toBe(false);
    expect(saved.classes.io).toEqual({ min: 1, max: 4 });
    expect(saved.classes.cpu).toEqual(defaultGovernorSettings(8).classes.cpu);
    expect(() => writeGovernorSettings(harness.sqlite, { classes: { io: { min: 5, max: 2 } } })).toThrow();
  });
});

describe("resource governor: AIMD", () => {
  it("starts at the class minimum and adds one slot per sample while full and under target", async () => {
    const harness = makeHarness();
    const { governor } = build(harness);
    expect(governor.limitOf("io")).toBe(2);
    fill(governor, "io");
    await governor.tick();
    expect(governor.limitOf("io")).toBe(3);
    fill(governor, "io");
    await governor.tick();
    expect(governor.limitOf("io")).toBe(4);
    fill(governor, "io");
    expect(governor.hasSlot("io")).toBe(false);
  });

  it("does not grow when nothing is waiting and the class is not full", async () => {
    const harness = makeHarness();
    const { governor } = build(harness);
    await governor.tick();
    expect(governor.limitOf("io")).toBe(2);
  });

  it("halves a class limit when the machine is over target and never goes below the minimum", async () => {
    const harness = makeHarness();
    const { governor, load } = build(harness);
    for (let i = 0; i < 6; i += 1) {
      fill(governor, "io");
      await governor.tick();
    }
    const grown = governor.limitOf("io");
    expect(grown).toBeGreaterThanOrEqual(6);
    load.state.sample = { ...CALM, ramPct: 92 };
    await governor.tick();
    expect(governor.limitOf("io")).toBe(Math.floor(grown / 2));
    for (let i = 0; i < 5; i += 1) await governor.tick();
    expect(governor.limitOf("io")).toBe(2);
  });

  it("throttles only the classes the hot resource touches", async () => {
    const harness = makeHarness();
    const { governor, load } = build(harness);
    for (let i = 0; i < 4; i += 1) {
      fill(governor, "cpu");
      fill(governor, "io");
      await governor.tick();
    }
    const io = governor.limitOf("io");
    const cpu = governor.limitOf("cpu");
    expect(cpu).toBeGreaterThan(1);
    load.state.sample = { ...CALM, cpuPct: 97 };
    await governor.tick();
    expect(governor.limitOf("cpu")).toBe(Math.max(1, Math.floor(cpu / 2)));
    expect(governor.limitOf("io")).toBeGreaterThanOrEqual(io);
  });

  it("treats low free disk as over target and does not grow", async () => {
    const harness = makeHarness();
    const { governor, load } = build(harness);
    load.state.sample = { ...CALM, diskFreeBytes: 1 * 1024 ** 3 };
    fill(governor, "io");
    await governor.tick();
    expect(governor.limitOf("io")).toBe(2);
    expect(governor.status().overVi).toContain("ổ đĩa gần đầy");
  });

  it("keeps every limit at or below WORKER_CONCURRENCY and the configured max", async () => {
    const harness = makeHarness();
    const { governor } = build(harness, { workerCap: 3 });
    for (let i = 0; i < 10; i += 1) {
      for (const cls of ["cpu", "gpu", "io", "llm"] as const) fill(governor, cls);
      await governor.tick();
    }
    expect(governor.limitOf("io")).toBe(3);
    expect(governor.limitOf("llm")).toBe(3);
    writeGovernorSettings(harness.sqlite, { enabled: true, classes: { io: { min: 1, max: 2 } } }, harness.clock(), 8);
    expect(governor.limitOf("io")).toBe(2);
  });

  it("holds the llm class while a provider cooldown is active and halves once on onset", async () => {
    const harness = makeHarness();
    const { governor } = build(harness);
    for (let i = 0; i < 4; i += 1) {
      fill(governor, "llm");
      await governor.tick();
    }
    const before = governor.limitOf("llm");
    expect(before).toBeGreaterThan(3);
    harness.sqlite.prepare("INSERT INTO llm_cooldowns (provider, model, until, reason, set_at) VALUES ('p', 'm', ?, 'quota', ?)")
      .run(new Date(harness.clock().getTime() + 600_000).toISOString(), harness.clock().toISOString());
    await governor.tick();
    const during = governor.limitOf("llm");
    expect(during).toBe(Math.max(2, Math.floor(before / 2)));
    fill(governor, "llm");
    await governor.tick();
    await governor.tick();
    expect(governor.limitOf("llm")).toBe(during);
    harness.advance(700_000);
    fill(governor, "llm");
    await governor.tick();
    expect(governor.limitOf("llm")).toBe(during + 1);
  });

  it("lets everything through when disabled", () => {
    const harness = makeHarness();
    writeGovernorSettings(harness.sqlite, { enabled: false }, harness.clock(), 8);
    const { governor } = build(harness);
    saturate(governor, "io", 20);
    expect(governor.hasSlot("io")).toBe(true);
  });

  it("samples every 5 seconds with fake timers and a fake sampler", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    const load = fakeSampler();
    const sampler = vi.fn(load.sampler);
    const governor = new ResourceGovernor({ sqlite: harness.sqlite, sampler, workerCap: 8, cores: 4, now: harness.clock });
    governor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sampler).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sampler).toHaveBeenCalledTimes(3);
    governor.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sampler).toHaveBeenCalledTimes(3);
    expect(governor.status().sample?.cpuPct).toBe(20);
  });
});

function queueJob(harness: Harness, stage: string, waitedMs: number, projectId?: string) {
  const at = new Date(harness.clock().getTime() - waitedMs).toISOString();
  harness.sqlite.prepare(`INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, created_at, run_after, previous_state)
    VALUES (?, ?, ?, 'QUEUED', 0, 1, 3, ?, ?, 'PENDING')`).run(randomUUID(), projectId ?? harness.projectId, stage, at, at);
}

function profileWithTopics(harness: Harness, topics: number, level: "assist" | "autonomous" = "autonomous") {
  const id = randomUUID();
  const at = harness.clock().toISOString();
  harness.sqlite.prepare(`INSERT INTO profiles (id, name, default_brief, guidelines, automation, created_at, updated_at)
    VALUES (?, ?, '{}', '{}', '{"enabled":true}', ?, ?)`).run(id, `Kênh ${id.slice(0, 4)}`, at, at);
  const settings = { level, grants: AUTONOMY_PRESETS[level] } as never;
  saveAutonomySettings(harness.sqlite, settings, id);
  saveAutonomySettings(harness.sqlite, settings);
  for (let i = 0; i < topics; i += 1) {
    harness.sqlite.prepare(`INSERT INTO profile_topics (id, profile_id, topic, source, status, created_at, updated_at)
      VALUES (?, ?, ?, 'MANUAL', 'APPROVED', ?, ?)`).run(randomUUID(), id, `Chủ đề ${i}`, at, at);
  }
  return id;
}

describe("resource governor: starved and idle", () => {
  it("reports starvation only when jobs waited over 15 minutes and the slots are full", () => {
    const harness = makeHarness();
    const { governor } = build(harness);
    queueJob(harness, "VISUAL_SEARCH", 20 * 60_000);
    expect(governor.starved()).toEqual([]);
    saturate(governor, "io", 2);
    const starved = governor.starved();
    expect(starved).toHaveLength(1);
    expect(starved[0]).toMatchObject({ class: "io", waiting: 1, limit: 2, running: 2 });
  });

  it("ignores short waits and the protected project", () => {
    const harness = makeHarness();
    const { governor } = build(harness);
    saturate(governor, "io", 2);
    const at = harness.clock().toISOString();
    harness.sqlite.prepare(`INSERT INTO projects (id, title, topic, mode, settings, status, stage, version, created_at, updated_at)
      VALUES (?, 'Giữ nguyên', 'x', 'ASSISTED', '{}', 'DRAFT', 'TOPIC', 1, ?, ?)`).run(PROTECTED_PROJECT_ID, at, at);
    queueJob(harness, "VISUAL_SEARCH", 5 * 60_000);
    queueJob(harness, "VISUAL_SEARCH", 40 * 60_000, PROTECTED_PROJECT_ID);
    expect(governor.starved()).toEqual([]);
  });

  it("asks the duty agent after 10 idle minutes and never starts a topic", async () => {
    const harness = makeHarness();
    const publish = vi.fn();
    const profileId = profileWithTopics(harness, 3);
    const { governor } = build(harness, { publish: publish as never });
    await governor.tick();
    expect(publish).not.toHaveBeenCalled();
    harness.advance(9 * 60_000);
    await governor.tick();
    expect(publish).not.toHaveBeenCalled();
    harness.advance(2 * 60_000);
    await governor.tick();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({ type: "capacity_idle", link: `/profiles/${profileId}/automation` });
    expect(publish.mock.calls[0][0].summary).toContain("3 chủ đề");
    harness.advance(10 * 60_000);
    await governor.tick();
    expect(publish).toHaveBeenCalledTimes(1);
    const topics = harness.sqlite.prepare("SELECT COUNT(*) AS n FROM profile_topics WHERE status = 'APPROVED' AND project_id IS NULL").get() as { n: number };
    expect(topics.n).toBe(3);
  });

  it("stays quiet when autonomy is off", async () => {
    const harness = makeHarness();
    const publish = vi.fn();
    profileWithTopics(harness, 2, "assist");
    const { governor } = build(harness, { publish: publish as never });
    await governor.tick();
    harness.advance(11 * 60_000);
    await governor.tick();
    expect(publish).not.toHaveBeenCalled();
  });

  it("stays quiet when the budget is spent", async () => {
    const harness = makeHarness();
    const publish = vi.fn();
    profileWithTopics(harness, 2);
    const { governor } = build(harness, { publish: publish as never, budgetStopped: () => true });
    await governor.tick();
    harness.advance(11 * 60_000);
    await governor.tick();
    expect(publish).not.toHaveBeenCalled();
  });

  it("stays quiet while jobs are waiting", async () => {
    const harness = makeHarness();
    const publish = vi.fn();
    profileWithTopics(harness, 2);
    queueJob(harness, "SCRIPT", 1_000);
    const { governor } = build(harness, { publish: publish as never });
    await governor.tick();
    harness.advance(11 * 60_000);
    queueJob(harness, "SCRIPT", 1_000);
    await governor.tick();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("resource governor: worker", () => {
  async function workerSetup(max: number) {
    const harness = makeHarness({ config: { WORKER_CONCURRENCY: 3, RENDER_CONCURRENCY: 1, FAKE_STAGE_DELAY_MS: 0 } });
    writeGovernorSettings(harness.sqlite, { enabled: true, classes: { llm: { min: max, max } } }, harness.clock(), 8);
    const governor = new ResourceGovernor({ sqlite: harness.sqlite, sampler: fakeSampler().sampler, workerCap: 3, cores: 8, now: harness.clock });
    harness.worker.setGovernor(governor);
    const settings = JSON.stringify({ language: "en", targetDurationSec: 120, aspectRatio: "16:9", edit: { engine: "legacy" }, stageExecutors: {}, autoRender: false });
    const at = harness.clock().toISOString();
    const projects = [harness.projectId];
    for (let i = 0; i < 2; i += 1) {
      const id = randomUUID();
      harness.sqlite.prepare(`INSERT INTO projects (id, title, topic, mode, settings, status, stage, version, created_at, updated_at)
        VALUES (?, 'Lane', 'Topic', 'ASSISTED', ?, 'DRAFT', 'TOPIC', 1, ?, ?)`).run(id, settings, at, at);
      harness.repository.ensureStages(id);
      projects.push(id);
    }
    for (const projectId of projects) {
      const job = harness.repository.createJob({ projectId, stage: "RESEARCH", maxAttempts: 1, previousState: "PENDING" });
      harness.repository.updateStage(projectId, "RESEARCH", { state: "QUEUED", progress: 0, message: "Waiting", jobId: job.id });
    }
    return { harness, governor };
  }

  it("starts jobs by class slot, not by the fixed worker count", async () => {
    const { harness, governor } = await workerSetup(1);
    let active = 0;
    let peak = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    harness.executors.set("RESEARCH", {
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return { message: "ok" };
      },
    });
    const tick = harness.worker.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(1);
    expect(governor.runningIn("llm")).toBe(1);
    release();
    await tick;
    expect(governor.runningIn("llm")).toBe(0);
  });

  it("still stops at WORKER_CONCURRENCY when class limits allow more", async () => {
    const { harness } = await workerSetup(8);
    let active = 0;
    let peak = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    harness.executors.set("RESEARCH", {
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return { message: "ok" };
      },
    });
    const tick = harness.worker.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(3);
    release();
    await tick;
  });
});

describe("resource governor: supervisor", () => {
  it("raises resource_starved with a hint, and resolves it when the wait ends", () => {
    const harness = makeHarness();
    const { governor } = build(harness);
    const supervisor = new AutonomySupervisor({
      repository: harness.repository, usage: new UsageService(harness.sqlite, 25_000), stageTimeoutMs: 600_000,
      logger: { warn: () => undefined, error: () => undefined, info: () => undefined } as never,
      now: harness.clock, governor: { starved: (now) => governor.starved(now) },
    });
    const found = () => listSupervisorState(harness.sqlite).findings.filter(({ kind }) => kind === "resource_starved");
    saturate(governor, "io", 2);
    queueJob(harness, "VISUAL_SEARCH", 5 * 60_000);
    supervisor.runPass();
    expect(found()).toHaveLength(0);
    harness.advance(11 * 60_000);
    supervisor.runPass();
    expect(found()).toHaveLength(1);
    expect(JSON.stringify(found()[0])).toContain("Thêm một máy worker");
    harness.sqlite.prepare("UPDATE jobs SET status = 'SUCCEEDED' WHERE status = 'QUEUED'").run();
    supervisor.runPass();
    expect(found()).toHaveLength(0);
  });
});
