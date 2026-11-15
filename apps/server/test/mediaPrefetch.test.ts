import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { ComposePlan, Job, Project } from "@vg/shared";
import { MediaFetchService, mediaPrefetchEnabled } from "../src/node/mediaFetch.js";
import { collectPlanFootageItems, downloadChosenFootage, prefetchPlanFootage } from "../src/services/composeBridge.js";
import type { FootageHit } from "../src/providers/footage/types.js";
import type { JobRepository } from "../src/jobs/jobRepository.js";

function makeFakeJobRepo() {
  const jobs: Job[] = [];
  let seq = 1;
  const repo: JobRepository = {
    createJob: (input) => {
      const job: Job = {
        id: `job-${seq++}`,
        projectId: input.projectId,
        stage: input.stage,
        status: "QUEUED",
        priority: input.priority ?? 5,
        attempt: 1,
        maxAttempts: 3,
        runAfter: new Date().toISOString(),
        lockedBy: null,
        lockedUntil: null,
        progress: 0,
        result: null,
        error: null,
        checkpoint: null,
        scope: input.scope ?? null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.push(job);
      return job;
    },
    listJobs: (_projectId, _limit) => jobs,
    getJob: (id) => jobs.find((j) => j.id === id) ?? null,
  } as unknown as JobRepository;
  return { repo, jobs };
}

describe("Media prefetch ahead of render (TASK-131)", () => {
  const dummyHit: FootageHit = {
    provider: "pexels",
    clipId: "12345",
    url: "https://example.com/clip1.mp4",
    width: 1920,
    height: 1080,
    durationSec: 10,
    author: "Alice",
    licenseName: "Pexels License",
    pageUrl: "https://pexels.com/video/12345",
    files: [{ url: "https://example.com/clip1.mp4", width: 1920, height: 1080 }],
  };

  const dummyPlan: ComposePlan = {
    orientation: "16:9",
    targetDurationSec: 10,
    scenes: [
      {
        sceneId: "scene-1",
        shots: [
          {
            shotId: "shot-1",
            kind: "footage",
            startSec: 0,
            durationSec: 5,
            source: {
              kind: "footage",
              clipId: "12345",
              license: { provider: "pexels", name: "Pexels License", pageUrl: "https://pexels.com/video/12345", author: "Alice" },
              path: null,
            },
          },
          {
            shotId: "shot-2",
            kind: "graphic",
            startSec: 5,
            durationSec: 5,
            source: {
              kind: "graphic",
              templateId: "kinetic_words",
              variables: {},
            },
          },
        ],
      },
    ],
  };

  const hits = new Map<string, FootageHit>([["pexels:12345", dummyHit]]);

  it("a plan with uncached footage -> one MEDIA_FETCH job holding exactly the missing items", () => {
    const { repo, jobs } = makeFakeJobRepo();
    const tempDir = join(process.cwd(), "data", "test-media-prefetch-1");
    mkdirSync(tempDir, { recursive: true });
    const service = new MediaFetchService(repo, tempDir);

    const job = prefetchPlanFootage(service, "project-1", dummyPlan, hits, 720);
    expect(job).not.toBeNull();
    expect(job?.stage).toBe("MEDIA_FETCH");
    expect(jobs.length).toBe(1);

    const parsedScope = JSON.parse(job!.scope!);
    expect(parsedScope.items).toHaveLength(1);
    expect(parsedScope.items[0].clipId).toBe("12345");
  });

  it("everything cached -> no job", () => {
    const { repo } = makeFakeJobRepo();
    const tempDir = join(process.cwd(), "data", "test-media-prefetch-2");
    const footageDir = join(tempDir, "footage");
    mkdirSync(footageDir, { recursive: true });
    // Write fake cached target
    writeFileSync(join(footageDir, "pexels-12345-1080.mp4"), "fake-video");

    const service = new MediaFetchService(repo, tempDir);
    const job = prefetchPlanFootage(service, "project-1", dummyPlan, hits, 720);
    expect(job).toBeNull();
  });

  it("a second trigger while one is queued -> no duplicate", () => {
    const { repo, jobs } = makeFakeJobRepo();
    const tempDir = join(process.cwd(), "data", "test-media-prefetch-3");
    mkdirSync(tempDir, { recursive: true });
    const service = new MediaFetchService(repo, tempDir);

    const job1 = prefetchPlanFootage(service, "project-1", dummyPlan, hits, 720);
    expect(job1).not.toBeNull();
    expect(jobs.length).toBe(1);

    const job2 = prefetchPlanFootage(service, "project-1", dummyPlan, hits, 720);
    expect(job2).toBeNull();
    expect(jobs.length).toBe(1);
  });

  it("media.prefetch off -> no job", () => {
    const { repo } = makeFakeJobRepo();
    const tempDir = join(process.cwd(), "data", "test-media-prefetch-4");
    mkdirSync(tempDir, { recursive: true });
    const service = new MediaFetchService(repo, tempDir);

    const db = new Database(":memory:");
    db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
    db.prepare("INSERT INTO app_settings VALUES ('media.prefetch', 'false', datetime('now'))").run();

    const enabled = mediaPrefetchEnabled(db);
    expect(enabled).toBe(false);

    const job = prefetchPlanFootage(service, "project-1", dummyPlan, hits, 720, { sqlite: db });
    expect(job).toBeNull();
  });

  it("RENDER still downloads what is missing when prefetch has not finished", async () => {
    const plan = JSON.parse(JSON.stringify(dummyPlan)) as ComposePlan;
    let ensureCalled = 0;
    const warnings = await downloadChosenFootage(plan, hits, async (hit) => {
      ensureCalled++;
      return { path: `/data/footage/${hit.provider}-${hit.clipId}.mp4` };
    });

    expect(warnings).toHaveLength(0);
    expect(ensureCalled).toBe(1);
    expect(plan.scenes[0].shots[0].source.kind === "footage" && plan.scenes[0].shots[0].source.path).toBe(
      "/data/footage/pexels-12345.mp4",
    );
  });
});
