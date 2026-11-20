import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { runAsActor } from "../src/auth/requestContext.js";
import { AgentStageService } from "../src/agents/stageService.js";
import { saveAgentAssignment } from "../src/agents/assignments.js";
import { AgentResearchToolkit } from "../src/agents/researchToolkit.js";
import { createResearchAdapter } from "../src/agents/stageAdapters/research.js";
import { ScriptService } from "../src/services/scriptService.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { ResearchNotesSchema, StoredResearchNotesSchema } from "@vg/shared";
import type { TrustedAgent } from "../src/supervision/identity.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { actorWith } from "./testActor.js";

const agent: TrustedAgent = { kind: "hermes", name: "research", instance: "hermes/research", model: null, environment: "test", trusted: true, canSupervise: false };
const scoped = <T>(fn: () => T) => runAsActor(actorWith({ role: "owner", kind: "apikey", workspaceId: "A" }), fn);
const DENYLIST = "blocked.example";
const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { fixtures.splice(0).forEach((h) => h.close()); });

/** n facts; the first `sourced` carry a source, the rest none. */
function notes(n: number, sourced: number, overrides: { url?: string; quote?: string } = {}) {
  return {
    summary: "Tóm tắt chủ đề.",
    keyFacts: Array.from({ length: n }, (_, i) => ({
      fact: `Sự kiện ${i + 1}`,
      confidence: "high" as const,
      sourceHint: null,
      source: i < sourced
        ? { url: overrides.url ?? `https://news.example/article-${i + 1}`, title: `Bài ${i + 1}`, quote: overrides.quote ?? "Đoạn trích ngắn từ trang nguồn." }
        : null,
    })),
    timeline: [{ date: "2026", event: "Mốc thời gian." }],
    angles: ["Góc nhìn chính"],
    outline: ["Mở đầu", "Diễn biến", "Kết luận"],
    cautions: [],
  };
}

function setup() {
  const h = createPipelineHarness(); fixtures.push(h);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: agent.instance, role: "research_scout" });
  h.repository.ensureStages(h.projectId);
  let research: AgentResearchToolkit;
  const lazy = { context: (job: Parameters<AgentResearchToolkit["context"]>[0]) => research.context(job), validateComplete: (job: Parameters<AgentResearchToolkit["validateComplete"]>[0]) => research.validateComplete(job) };
  const stages = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock,
    adapters: [createResearchAdapter({ research: lazy })] });
  research = new AgentResearchToolkit(h.repository, stages, DENYLIST);
  const job = h.repository.createJob({ projectId: h.projectId, stage: "RESEARCH", maxAttempts: 3, previousState: "PENDING" });
  stages.handoff(job.id, "LLM_QUOTA_EXHAUSTED");
  const claim = scoped(() => stages.claim(agent))!;
  const submit = (input = notes(6, 4), leaseId = claim.leaseId) => scoped(() => research.submit(agent, job.id, leaseId, input));
  const row = () => h.sqlite.prepare("SELECT input_hash, provider, data FROM research_notes WHERE project_id=?").get(h.projectId) as
    { input_hash: string; provider: string; data: string } | undefined;
  return { ...h, stages, research, job, claim, submit, row };
}

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (error) { return (error as { code?: string }).code ?? "UNKNOWN"; }
}
function problemsOf(fn: () => unknown): string[] {
  try { fn(); return []; } catch (error) { return ((error as { details?: { problems?: string[] } }).details?.problems) ?? []; }
}

describe("research_scout agent submit gate (TASK-147b)", () => {
  it("accepts valid notes and completes the job", async () => {
    const h = setup();
    const result = h.submit();
    expect(result).toMatchObject({ keyFacts: 6, sourced: 4, changed: true });
    expect(h.row()?.provider).toBe(`agent:${h.claim.leaseId}`);
    await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "Đã nộp notes."));
  });

  it("refuses fewer than six facts and leaves the stored notes untouched", () => {
    const h = setup();
    h.submit();
    const before = h.row()?.data;
    expect(codeOf(() => h.submit(notes(5, 5)))).toBe("RESEARCH_AGENT_INVALID");
    expect(problemsOf(() => h.submit(notes(5, 5)))[0]).toContain("Cần ít nhất 6");
    expect(h.row()?.data).toBe(before);
  });

  it("refuses when fewer than 60% of facts have a source", () => {
    const h = setup();
    const problems = problemsOf(() => h.submit(notes(6, 3)));
    expect(problems.some((p) => p.includes("3/6") && p.includes("60%"))).toBe(true);
  });

  it("refuses a quote longer than 30 words", () => {
    const h = setup();
    const longQuote = Array.from({ length: 31 }, (_, i) => `từ${i}`).join(" ");
    const problems = problemsOf(() => h.submit(notes(6, 6, { quote: longQuote })));
    expect(problems).toHaveLength(6);
    expect(problems[0]).toContain("quote 31 từ");
  });

  it("refuses a denied domain from the 074a list", () => {
    const h = setup();
    expect(problemsOf(() => h.submit(notes(6, 6, { url: "https://blocked.example/a" })))[0]).toContain("miền bị chặn");
    expect(problemsOf(() => h.submit(notes(6, 6, { url: "https://sub.blocked.example/a" })))[0]).toContain("miền bị chặn");
  });

  it("refuses private, loopback and non-http sources", () => {
    const h = setup();
    expect(problemsOf(() => h.submit(notes(6, 6, { url: "http://127.0.0.1/admin" })))[0]).toContain("máy nội bộ");
    expect(problemsOf(() => h.submit(notes(6, 6, { url: "http://192.168.1.5/x" })))[0]).toContain("máy nội bộ");
    expect(problemsOf(() => h.submit(notes(6, 6, { url: "http://localhost:3000/x" })))[0]).toContain("máy nội bộ");
    expect(problemsOf(() => h.submit(notes(6, 6, { url: "ftp://example.com/x" })))[0]).toContain("không phải http");
  });

  it("refuses a stale lease with LEASE_LOST and writes nothing", () => {
    const h = setup();
    expect(codeOf(() => h.submit(notes(6, 4), randomUUID()))).toBe("LEASE_LOST");
    expect(h.row()).toBeUndefined();
  });

  it("does not report a change when the same valid notes are resubmitted", () => {
    const h = setup();
    expect(h.submit()).toMatchObject({ changed: true });
    expect(h.submit()).toMatchObject({ changed: false });
  });

  it("complete rejects notes written by a different lease", async () => {
    const h = setup();
    h.submit();
    h.sqlite.prepare("UPDATE research_notes SET provider='agent:someone-else' WHERE project_id=?").run(h.projectId);
    let code: string | null = null;
    try { await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")); } catch (error) { code = (error as { code?: string }).code ?? "UNKNOWN"; }
    expect(code).toBe("RESEARCH_AGENT_INVALID");
  });

  it("complete rejects notes whose input hash no longer matches the project", async () => {
    const h = setup();
    h.submit();
    h.sqlite.prepare("UPDATE research_notes SET input_hash='stale-hash' WHERE project_id=?").run(h.projectId);
    let code: string | null = null;
    try { await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")); } catch (error) { code = (error as { code?: string }).code ?? "UNKNOWN"; }
    expect(code).toBe("RESEARCH_AGENT_INVALID");
  });

  it("marks a DONE script stale when changed research is submitted, and not when unchanged notes come back", () => {
    const h = setup();
    h.repository.updateStage(h.projectId, "SCRIPT", { state: "DONE", progress: 100 });
    expect(h.submit()).toMatchObject({ changed: true });
    expect(h.repository.getStage(h.projectId, "SCRIPT").state).toBe("STALE");
    h.repository.updateStage(h.projectId, "SCRIPT", { state: "DONE", progress: 100 });
    expect(h.submit()).toMatchObject({ changed: false });
    expect(h.repository.getStage(h.projectId, "SCRIPT").state).toBe("DONE");
  });

  it("stores agent sources so the LLM schema cannot read them but the stored schema and the research save route can", async () => {
    const h = setup();
    h.submit();
    await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "Đã nộp notes."));
    const stored = JSON.parse(h.row()!.data) as unknown;
    expect(StoredResearchNotesSchema.safeParse(stored).success).toBe(true);
    expect(ResearchNotesSchema.safeParse(stored).success).toBe(false);
    const service = new ScriptService(h.sqlite, h.repository, h.orchestrator, h.config);
    const saved = scoped(() => service.saveResearch(h.projectId, stored));
    expect(saved).toBeTruthy();
    const back = JSON.parse(h.row()!.data) as { keyFacts: Array<{ source: unknown }> };
    expect(back.keyFacts.filter((fact) => fact.source).length).toBe(4);
  });

  it("does not hand a default-mode research job to an agent on LLM quota errors", () => {
    const h = setup();
    const job = h.repository.createJob({ projectId: h.projectId, stage: "RESEARCH", maxAttempts: 3, previousState: "PENDING" });
    expect(h.stages.mode(job)).toBe("app");
    expect(h.stages.afterError(job, { code: "LLM_QUOTA_EXHAUSTED", message: "quota" } as never)).toBe(false);
    expect(h.repository.getJob(job.id)!.executor).toBe("app");
  });

  it("refuses a source without a quote as RESEARCH_AGENT_INVALID with problems, and writes nothing", () => {
    const h = setup();
    const bad = notes(6, 6);
    (bad.keyFacts[0].source as { quote?: string }).quote = undefined;
    expect(codeOf(() => h.submit(bad as never))).toBe("RESEARCH_AGENT_INVALID");
    expect(problemsOf(() => h.submit(bad as never))[0]).toContain("quote");
    expect(h.row()).toBeUndefined();
  });

  it("checks the lease before the notes shape, so a stale lease still returns LEASE_LOST", () => {
    const h = setup();
    const bad = notes(6, 6);
    (bad.keyFacts[0].source as { quote?: string }).quote = undefined;
    expect(codeOf(() => h.submit(bad as never, randomUUID()))).toBe("LEASE_LOST");
  });
});
