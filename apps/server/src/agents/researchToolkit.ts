import { AgentResearchNotesSchema, StoredResearchNotesSchema, type AgentResearchNotes, type Job, type Project, type StoredResearchNotes } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { TrustedAgent } from "../supervision/identity.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import { isDeniedHost, parseDomainDenylist } from "../providers/images/webCrawl.js";
import { researchInputHash } from "../stages/script/scriptUtils.js";
import type { AgentStageService } from "./stageService.js";

export const RESEARCH_MIN_FACTS = 6;
export const RESEARCH_MIN_SOURCED_RATIO = 0.6;
export const RESEARCH_MAX_QUOTE_WORDS = 30;
export const RESEARCH_HANDOFF_ERRORS: readonly string[] = ["LLM_ALL_PROVIDERS_EXHAUSTED", "LLM_QUOTA_EXHAUSTED"];

type SourcedFact = { source?: { url: string; quote: string } | null };

/** Host literal that must never be cited: loopback, link-local and private names. Sync, no DNS. */
export function isPrivateLiteralHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  if (host === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const m = /^172\.(\d+)\./.exec(host);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

/** The app gate. Returns Vietnamese problem lines; an empty list means the notes may be written. */
export function researchProblems(notes: { keyFacts: SourcedFact[] }, denylist: readonly string[]): string[] {
  const problems: string[] = [];
  const total = notes.keyFacts.length;
  if (total < RESEARCH_MIN_FACTS) problems.push(`Cần ít nhất ${RESEARCH_MIN_FACTS} keyFacts, hiện có ${total}.`);
  const sourced = notes.keyFacts.filter((fact) => fact.source);
  if (total && sourced.length / total < RESEARCH_MIN_SOURCED_RATIO) {
    problems.push(`Chỉ ${sourced.length}/${total} fact có nguồn; cần ít nhất ${Math.ceil(RESEARCH_MIN_SOURCED_RATIO * 100)}%.`);
  }
  notes.keyFacts.forEach((fact, index) => {
    if (!fact.source) return;
    const label = `Fact ${index + 1}`;
    const words = fact.source.quote.trim().split(/\s+/).filter(Boolean).length;
    if (words > RESEARCH_MAX_QUOTE_WORDS) problems.push(`${label}: quote ${words} từ, tối đa ${RESEARCH_MAX_QUOTE_WORDS}.`);
    let host: string;
    try {
      const parsed = new URL(fact.source.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") { problems.push(`${label}: nguồn không phải http(s).`); return; }
      host = parsed.hostname;
    } catch {
      problems.push(`${label}: URL nguồn không hợp lệ.`);
      return;
    }
    if (isPrivateLiteralHost(host)) problems.push(`${label}: nguồn trỏ tới máy nội bộ.`);
    else if (isDeniedHost(host, denylist)) problems.push(`${label}: nguồn thuộc miền bị chặn (danh sách 074a).`);
  });
  return problems;
}

function normalize(input: AgentResearchNotes): StoredResearchNotes {
  return {
    ...input,
    keyFacts: input.keyFacts.map((fact) => ({
      ...fact,
      sourceHint: fact.source ? fact.source.url : (fact.sourceHint ?? null),
      source: fact.source ?? null,
    })),
  };
}

export class AgentResearchToolkit {
  constructor(
    private readonly repository: JobRepository,
    private readonly stages: AgentStageService,
    private readonly denylistConfig: string,
  ) {}

  private get denylist(): string[] { return parseDomainDenylist(this.denylistConfig); }

  private projectOf(job: Job): Project {
    const project = this.repository.getProject(job.projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  context(job: Job) {
    const project = this.projectOf(job);
    return {
      projectId: project.id,
      topic: project.topic,
      requirements: {
        minFacts: RESEARCH_MIN_FACTS,
        minSourcedRatio: RESEARCH_MIN_SOURCED_RATIO,
        maxQuoteWords: RESEARCH_MAX_QUOTE_WORDS,
        sourceRule: "Mỗi fact có nguồn: source {url, title, quote}. Chỉ dùng URL công khai http(s); miền bị chặn và máy nội bộ bị từ chối.",
      },
    };
  }

  /** Lease-fenced write. The gate runs before any row is touched, so a refused submit keeps the previous notes. */
  submit(agent: TrustedAgent, jobId: string, leaseId: string, input: unknown) {
    return this.stages.withLease(agent, jobId, leaseId, (job) => {
      const project = this.projectOf(job);
      const shape = AgentResearchNotesSchema.safeParse(input);
      if (!shape.success) {
        const problems = shape.error.issues.map((issue) => `${issue.path.join(".") || "notes"}: ${issue.message}`);
        throw new AppError(422, "RESEARCH_AGENT_INVALID", `Notes sai cấu trúc: ${problems.join("; ")}`, { problems });
      }
      const notes = normalize(shape.data);
      const problems = researchProblems(notes, this.denylist);
      if (problems.length) {
        throw new AppError(422, "RESEARCH_AGENT_INVALID", `Notes chưa đạt cổng nghiên cứu: ${problems.join(" ")}`, { problems });
      }
      const sqlite = this.repository.sqlite;
      const previous = sqlite.prepare("SELECT data FROM research_notes WHERE project_id = ?").get(project.id) as { data: string } | undefined;
      const prior = previous ? StoredResearchNotesSchema.safeParse(JSON.parse(previous.data) as unknown) : null;
      const changed = !prior?.success || JSON.stringify(prior.data) !== JSON.stringify(notes);
      sqlite.prepare(
        "INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, ?, ?, ?, false, ?, ?) ON CONFLICT(project_id) DO UPDATE SET input_hash = excluded.input_hash, provider = excluded.provider, model = excluded.model, cached = excluded.cached, created_at = excluded.created_at, data = excluded.data",
      ).run(
        project.id,
        researchInputHash(project),
        `agent:${leaseId}`,
        agent.model ?? "agent",
        new Date().toISOString(),
        JSON.stringify(notes),
      );
      if (changed) markStaleFrom(this.repository, project.id, "RESEARCH");
      return { projectId: project.id, keyFacts: notes.keyFacts.length, sourced: notes.keyFacts.filter((fact) => fact.source).length, changed };
    });
  }

  /** Re-checks at complete: the row must come from this lease, match the current input, and pass the gate. */
  validateComplete(job: Job): void {
    const project = this.projectOf(job);
    const lease = this.repository.getExecutionLease(job.id);
    const row = this.repository.sqlite.prepare("SELECT input_hash, provider, data FROM research_notes WHERE project_id = ?")
      .get(project.id) as { input_hash: string; provider: string; data: string } | undefined;
    const problems: string[] = [];
    if (!row) problems.push("Chưa có notes nghiên cứu.");
    else if (!lease || row.provider !== `agent:${lease.leaseId}`) problems.push("Notes không do lượt nhận việc này nộp.");
    else if (row.input_hash !== researchInputHash(project)) problems.push("Notes không khớp đầu vào nghiên cứu hiện tại.");
    else {
      const stored = StoredResearchNotesSchema.safeParse(JSON.parse(row.data) as unknown);
      if (!stored.success) problems.push("Notes lưu không đúng cấu trúc.");
      else problems.push(...researchProblems(stored.data, this.denylist));
    }
    if (problems.length) {
      throw new AppError(422, "RESEARCH_AGENT_INVALID", `Notes chưa đạt cổng nghiên cứu: ${problems.join(" ")}`, { problems });
    }
  }
}
