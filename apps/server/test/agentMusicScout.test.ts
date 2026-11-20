import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { runAsActor } from "../src/auth/requestContext.js";
import { AgentStageService } from "../src/agents/stageService.js";
import { saveAgentAssignment } from "../src/agents/assignments.js";
import { AgentMusicToolkit } from "../src/agents/musicToolkit.js";
import { createMusicAdapter } from "../src/agents/stageAdapters/music.js";
import { AudioStore } from "../src/services/audioStore.js";
import { AutoReportService } from "../src/services/autoReportService.js";
import { MusicService } from "../src/services/musicService.js";
import type { TrustedAgent } from "../src/supervision/identity.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { actorWith } from "./testActor.js";

const agent: TrustedAgent = { kind: "hermes", name: "music", instance: "hermes/music", model: null, environment: "test", trusted: true, canSupervise: false };
const scoped = <T>(fn: () => T) => runAsActor(actorWith({ role: "owner", kind: "apikey", workspaceId: "A" }), fn);
const DENYLIST = "blocked.example";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32)]);
const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
/** Runs on every audio fetch, so a test can expire the lease mid-download. */
let onFetch: (url: string) => void = () => {};
afterEach(() => { fixtures.splice(0).forEach((h) => h.close()); onFetch = () => {}; });

function candidate(i: number, overrides: Record<string, unknown> = {}) {
  return {
    title: `Track ${i}`,
    artist: "Artist",
    sourceUrl: `https://freemusic.example/track-${i}`,
    downloadUrl: `https://cdn.freemusic.example/t${i}.mp3`,
    licence: "CC_BY",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    durationSec: 95,
    mood: "calm",
    reason: "Hợp mood",
    ...overrides,
  };
}

function setup() {
  const h = createPipelineHarness(); fixtures.push(h);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: agent.instance, role: "music_scout" });
  h.repository.ensureStages(h.projectId);
  const audio = new AudioStore(h.config.DATA_DIR, "test-agent", {
    fetchImpl: async (input: RequestInfo | URL) => {
      onFetch(String(input));
      return String(input).includes("missing")
        ? new Response("nope", { status: 404 })
        : new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    },
    resolveHost: async () => ["93.184.216.34"],
  });
  const music = new MusicService(h.sqlite, h.config, [], audio, async () => 95);
  const autoReport = new AutoReportService(h.sqlite);
  let toolkit: AgentMusicToolkit;
  const lazy = {
    context: (job: Parameters<AgentMusicToolkit["context"]>[0]) => toolkit.context(job),
    validateComplete: (job: Parameters<AgentMusicToolkit["validateComplete"]>[0]) => toolkit.validateComplete(job),
    prepareComplete: (job: Parameters<AgentMusicToolkit["prepareComplete"]>[0]) => toolkit.prepareComplete(job),
  };
  const stages = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock, adapters: [createMusicAdapter({ music: lazy })] });
  toolkit = new AgentMusicToolkit(h.repository, stages, music, audio, async () => 95, h.config.DATA_DIR, DENYLIST, autoReport);
  const job = h.repository.createJob({ projectId: h.projectId, stage: "MUSIC_SEARCH", maxAttempts: 3, previousState: "PENDING" });
  stages.handoff(job.id, "MUSIC_SEARCH_FAILED");
  const claim = scoped(() => stages.claim(agent))!;
  const submit = (candidates: unknown[], leaseId = claim.leaseId) => scoped(() => toolkit.submit(agent, job.id, leaseId, { candidates }));
  const rows = () => h.sqlite.prepare("SELECT title, license, local_path, input_hash FROM music_candidates WHERE project_id=? AND provider='agent' ORDER BY rank").all(h.projectId) as Array<{ title: string; license: string; local_path: string | null; input_hash: string }>;
  const selection = () => h.sqlite.prepare("SELECT candidate_id, status, selected_by FROM music_selections WHERE project_id=?").get(h.projectId) as { candidate_id: string | null; status: string; selected_by: string };
  return { ...h, music, stages, toolkit, job, claim, submit, rows, selection };
}

async function codeOf(fn: () => unknown): Promise<string | null> {
  try { await fn(); return null; } catch (error) { return (error as { code?: string }).code ?? "UNKNOWN"; }
}

describe("music_scout agent submit (TASK-147c)", () => {
  it("stores screened, downloaded candidates and leaves the app's review pick in place", async () => {
    const h = setup();
    const result = await h.submit([candidate(1), candidate(2, { licence: "CC0", licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/" })]);
    expect(result).toMatchObject({ stored: 2, rejected: [] });
    expect(h.rows().map((row) => row.title)).toEqual(["Track 1", "Track 2"]);
    expect(h.rows().every((row) => row.local_path)).toBe(true);
    expect(JSON.parse(h.rows()[0].license)).toMatchObject({ kind: "CC_BY", evidence: "none" });
    const sel = h.selection();
    expect(sel.status).toBe("REVIEW_REQUIRED");
    expect(sel.selected_by).toBe("AGENT");
    expect(sel.candidate_id).toBeTruthy();
    await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "Đã nộp ứng viên."));
  });

  it("rejects a non-commercial licence and keeps the rest", async () => {
    const h = setup();
    const result = await h.submit([candidate(1, { licence: "CC_BY_NC" }), candidate(2)]);
    expect(result.stored).toBe(1);
    expect(result.rejected[0]).toMatchObject({ index: 0, title: "Track 1" });
    expect(result.rejected[0].reason).toContain("CC_BY_NC");
    expect(h.rows().map((row) => row.title)).toEqual(["Track 2"]);
  });

  it("rejects only the candidate whose download fails", async () => {
    const h = setup();
    const result = await h.submit([candidate(1, { downloadUrl: "https://cdn.freemusic.example/missing.mp3" }), candidate(2)]);
    expect(result.stored).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("Không tải được");
    expect(h.rows().map((row) => row.title)).toEqual(["Track 2"]);
  });

  it("refuses private hosts and denylisted domains in any URL", async () => {
    const h = setup();
    const result = await h.submit([
      candidate(1, { sourceUrl: "http://127.0.0.1/x" }),
      candidate(2, { downloadUrl: "https://blocked.example/t2.mp3" }),
      candidate(3, { licenceUrl: "https://sub.blocked.example/license" }),
    ]);
    expect(result.stored).toBe(0);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      expect.stringContaining("máy nội bộ"),
      expect.stringContaining("miền bị chặn"),
      expect.stringContaining("miền bị chặn"),
    ]);
  });

  it("refuses more than eight candidates in one call as MUSIC_AGENT_INVALID", async () => {
    const h = setup();
    const nine = Array.from({ length: 9 }, (_, i) => candidate(i));
    expect(await codeOf(() => h.submit(nine))).toBe("MUSIC_AGENT_INVALID");
    expect(h.rows()).toHaveLength(0);
  });

  it("caps the lease at eight stored candidates across several submits", async () => {
    const h = setup();
    expect((await h.submit(Array.from({ length: 5 }, (_, i) => candidate(i)))).stored).toBe(5);
    expect(await codeOf(() => h.submit(Array.from({ length: 4 }, (_, i) => candidate(10 + i))))).toBe("MUSIC_AGENT_INVALID");
    expect(h.rows()).toHaveLength(5);
  });

  it("drops a duplicate downloadUrl inside one submit instead of counting it twice", async () => {
    const h = setup();
    const result = await h.submit([candidate(1), candidate(1, { title: "Track 1 again" })]);
    expect(result.stored).toBe(1);
    expect(result.rejected[0].reason).toContain("Trùng");
    expect(h.rows().map((row) => row.title)).toEqual(["Track 1"]);
  });

  it("refuses a stale lease with LEASE_LOST and downloads nothing", async () => {
    const h = setup();
    let fetched = 0;
    onFetch = () => { fetched += 1; };
    expect(await codeOf(() => h.submit([candidate(1)], randomUUID()))).toBe("LEASE_LOST");
    expect(fetched).toBe(0);
    expect(h.rows()).toHaveLength(0);
  });

  it("loses the lease while downloads run: LEASE_LOST at the insert and no rows", async () => {
    const h = setup();
    onFetch = () => {
      h.sqlite.prepare("UPDATE jobs SET lease_until = ? WHERE id = ?").run(new Date(0).toISOString(), h.job.id);
    };
    expect(await codeOf(() => h.submit([candidate(1), candidate(2)]))).toBe("LEASE_LOST");
    expect(h.rows()).toHaveLength(0);
  });

  it("refuses to complete when no agent candidate was stored", async () => {
    const h = setup();
    await h.submit([candidate(1, { licence: "CC_BY_NC" })]);
    expect(await codeOf(() => scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")))).toBe("MUSIC_AGENT_INVALID");
  });

  it("refuses to complete when the only stored rows belong to an earlier lease", async () => {
    const h = setup();
    await h.submit([candidate(1)]);
    h.sqlite.prepare("UPDATE music_candidates SET input_hash = 'agent:older-lease' WHERE project_id = ?").run(h.projectId);
    expect(await codeOf(() => scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")))).toBe("MUSIC_AGENT_INVALID");
  });

  it("never sets the final pick from agent input, and keeps a user pick", async () => {
    const h = setup();
    h.music.selectNone(h.repository.getProject(h.projectId)!, "USER");
    await h.submit([candidate(1)]);
    const sel = h.selection();
    expect(sel.selected_by).toBe("USER");
    expect(sel.candidate_id).toBeNull();
  });

  it("an app re-search with force drops unselected agent rows but keeps the selected one", async () => {
    const h = setup();
    await h.submit([candidate(1), candidate(2)]);
    expect(h.rows()).toHaveLength(2);
    const project = h.repository.getProject(h.projectId)!;
    await h.music.search(project, { force: true });
    expect(h.rows().map((row) => row.title)).toEqual(["Track 1"]);
  });

  it("in AUTO mode the app makes the same pick the executor makes, before completion", async () => {
    const h = setup();
    h.sqlite.prepare("UPDATE projects SET mode = 'AUTO' WHERE id = ?").run(h.projectId);
    await h.submit([candidate(1), candidate(2)]);
    await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "Đã nộp ứng viên."));
    const sel = h.selection();
    expect(sel.status).toBe("APPROVED");
    expect(sel.selected_by).toBe("AGENT");
    expect(sel.candidate_id).toBeTruthy();
  });

  it("a wrong leaseId on complete fails before any AUTO pick runs", async () => {
    const h = setup();
    h.sqlite.prepare("UPDATE projects SET mode = 'AUTO' WHERE id = ?").run(h.projectId);
    await h.submit([candidate(1), candidate(2)]);
    expect(await codeOf(() => scoped(() => h.stages.complete(agent, h.job.id, randomUUID(), "x")))).toBe("LEASE_LOST");
    expect(h.selection()).toMatchObject({ status: "REVIEW_REQUIRED", selected_by: "AGENT" });
  });

  it("only hands MUSIC_SEARCH_FAILED to an agent in app_then_agent mode", () => {
    const h = setup();
    const job = h.repository.createJob({ projectId: h.projectId, stage: "MUSIC_SEARCH", maxAttempts: 3, previousState: "PENDING" });
    expect(h.stages.mode(job)).toBe("app");
    expect(h.stages.afterError(job, { code: "MUSIC_SEARCH_FAILED", message: "quota" } as never)).toBe(false);
    expect(h.repository.getJob(job.id)!.executor).toBe("app");
    h.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(
      JSON.stringify({ ...h.repository.getProject(h.projectId)!.settings, stageExecution: { MUSIC_SEARCH: "app_then_agent" } }), h.projectId);
    expect(h.stages.afterError(job, { code: "UNRELATED", message: "x" } as never)).toBe(false);
    expect(h.stages.afterError(job, { code: "MUSIC_SEARCH_FAILED", message: "download" } as never)).toBe(true);
    expect(h.repository.getJob(job.id)!.executor).toBe("agent");
  });
});
