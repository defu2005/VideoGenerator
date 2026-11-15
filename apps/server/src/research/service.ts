import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { KnowledgeEntrySchema, ResearchTriggerSchema, redactExportText, quoteInPage, type KnowledgeEntry, type SelfImprovementCounter } from "@vg/shared";
import { currentWorkspaceId } from "../auth/requestContext.js";
import { KnowledgeService } from "../knowledge/service.js";
import { consumeSelfImprovementBudget, selfImprovementSettings } from "../operator/autonomyBudget.js";
import { parseSkillMarkdown, type OperatorSkill } from "../operator/skills.js";
import { RESEARCH_SKILLS } from "./skills.js";
import type { SearchResult } from "../providers/web/search.js";
import type { ResearchPage } from "../providers/web/pages.js";
import { AppError } from "../lib/errors.js";
import { ChangeInbox } from "../knowledge/changeInbox.js";
import { researchEventVisible } from "./triggers.js";
import { LlmError } from "../providers/llm/types.js";

export const RunResearchSchema = z.object({ skill: z.string().min(1).max(80), subject: z.string().trim().min(1).max(1000),
  trigger: ResearchTriggerSchema.default("user"), knowledgeId: z.string().max(180).optional(), changeEventId: z.uuid().optional() }).strict();
const PlanSchema = z.object({ questions: z.array(z.string().trim().min(1).max(300)).min(1).max(6) });
const FactSchema = z.object({ field: z.string().min(1).max(180), value: z.json(), quote: z.string().max(1000).optional(),
  sourceUpdatedAt: z.iso.date().optional(), type: z.enum(["official", "industry", "anecdote", "inference"]) });
const ExtractSchema = z.object({ facts: z.array(FactSchema).max(30) });
const ProposeSchema = z.object({ entries: z.array(z.object({ entry: KnowledgeEntrySchema, factIds: z.array(z.string()).min(1).max(100) })).max(20),
  changed: z.string().max(1500), unchanged: z.string().max(1500), unconfirmed: z.string().max(1500) });
export type ResearchFact = z.infer<typeof FactSchema> & { id: string; url: string; verified: boolean; conflict: boolean };
export type ResearchModel = (input: { phase: "plan" | "extract" | "propose"; data: unknown; schema: z.ZodType; beforeCall: () => void }) => Promise<unknown>;
export type ResearchDependencies = {
  model: ResearchModel;
  search: (query: string, beforeCall: () => void) => Promise<SearchResult>;
  page: (url: string, beforeFetch: () => void) => Promise<ResearchPage>;
  skills?: () => Array<OperatorSkill & { version?: number; markdown?: string }>;
  now?: () => Date;
};
type RunRow = { id: string; skill: string; version: number; trigger: string; subject: string; status: string; budget_used: string;
  report: string; proposal_ids: string; details: string; change_event_id: string | null; created_at: string; finished_at: string | null };
const mapRun = (row: RunRow) => ({ id: row.id, skill: row.skill, version: row.version, trigger: row.trigger, subject: row.subject, status: row.status,
  budgetUsed: JSON.parse(row.budget_used) as Record<string, number>, report: row.report, proposalIds: JSON.parse(row.proposal_ids) as string[],
  details: JSON.parse(row.details) as unknown, changeEventId: row.change_event_id, createdAt: row.created_at, finishedAt: row.finished_at });

/** Deterministic research graph. Page/model content cannot choose tools, approve changes or alter budgets. */
export class ResearchService {
  constructor(private readonly db: Database.Database, private readonly deps: ResearchDependencies) {}
  list() { return (this.db.prepare("SELECT * FROM research_runs WHERE workspace_id IS ? ORDER BY created_at DESC,rowid DESC LIMIT 100").all(currentWorkspaceId(this.db)) as RunRow[]).map(mapRun); }
  get(id: string) {
    const row = this.db.prepare("SELECT * FROM research_runs WHERE id=? AND workspace_id IS ?").get(id, currentWorkspaceId(this.db)) as RunRow | undefined;
    if (!row) throw new AppError(404, "RESEARCH_NOT_FOUND", "Không tìm thấy lượt nghiên cứu.");
    return mapRun(row);
  }
  async run(raw: unknown, options: { manual: boolean }) {
    const input = RunResearchSchema.parse(raw), workspace = currentWorkspaceId(this.db);
    const known: Array<OperatorSkill & { version?: number; markdown?: string }> = this.deps.skills?.() ?? RESEARCH_SKILLS;
    const selected = known.find((skill) => skill.name === input.skill);
    const skill = selected?.markdown ? parseSkillMarkdown(selected.markdown)?.research : selected?.research;
    if (!skill) throw new AppError(400, "RESEARCH_SKILL_INVALID", "Skill không có cấu hình nghiên cứu hợp lệ.");
    if (input.changeEventId) {
      const event = new ChangeInbox(this.db).list().find((event) => event.id === input.changeEventId);
      if (!event || !researchEventVisible(this.db, event)) throw new AppError(404, "CHANGE_NOT_FOUND", "Không thấy thay đổi trong phạm vi này.");
    }
    const now = () => this.deps.now?.() ?? new Date(), id = randomUUID();
    const used: Partial<Record<SelfImprovementCounter, number>> = {};
    const spend = (counter: SelfImprovementCounter) => {
      consumeSelfImprovementBudget(this.db, counter, { manual: options.manual, now: now() }); used[counter] = (used[counter] ?? 0) + 1;
    };
    spend("researchRuns");
    this.db.prepare(`INSERT INTO research_runs(id,workspace_id,skill,version,trigger,subject,status,created_at,change_event_id)
      VALUES(?,?,?,?,?,?,'running',?,?)`).run(id, workspace, input.skill, selected?.version ?? 1, input.trigger, redactExportText(input.subject), now().toISOString(), input.changeEventId ?? null);
    const facts: ResearchFact[] = [], pages = new Map<string, ResearchPage>(), proposals: string[] = [], warnings: string[] = [];
    const knowledge = new KnowledgeService(this.db, now), current = input.knowledgeId ? knowledge.get(input.knowledgeId)?.entry : undefined;
    const preferred = new Set([...skill.sources, ...(current?.watch ?? []), ...(current?.evidence.filter((source) => source.type === "official") ?? [])].map((source) => typeof source === "string" ? source : new URL(source.url).hostname));
    const official = (url: string) => { const host = new URL(url).hostname; return [...preferred].some((domain) => host === domain || host.endsWith(`.${domain}`)); };
    const model = async <T>(phase: "plan" | "extract" | "propose", data: unknown, schema: z.ZodType<T>) => schema.parse(await this.deps.model({ phase, data, schema, beforeCall: () => spend("llmCalls") }));
    let status = "completed", report = "";
    try {
      const plan = await model("plan", { question: skill.question, subject: input.subject }, PlanSchema);
      const urls = new Set([...(current?.watch ?? []), ...(current?.evidence ?? [])].map((source) => source.url));
      for (const question of plan.questions) {
        const found = await this.deps.search(question, () => spend("llmCalls"));
        if (found.status === "unavailable") { warnings.push("Không có khóa hoặc route Gemini hỗ trợ tìm kiếm web."); continue; }
        for (const source of found.results) { try { if (new URL(source.url).protocol === "https:") urls.add(source.url); } catch { /* Invalid source is data, not an executable instruction. */ } }
      }
      const cap = Math.min(skill.maxPages, selfImprovementSettings(this.db).maxPages);
      for (const url of [...urls].sort((a, b) => Number(official(b)) - Number(official(a))).slice(0, cap)) {
        let page: ResearchPage;
        try { page = await this.deps.page(url, () => spend("webFetches")); }
        catch (error) {
          if (error instanceof AppError && error.code === "SELF_IMPROVEMENT_BUDGET_LIMIT") throw error;
          warnings.push(`Không đọc được nguồn: ${url}`); continue;
        }
        if (pages.has(page.url)) continue;
        pages.set(page.url, page);
        const extracted = await model("extract", { page, question: skill.question, subject: input.subject }, ExtractSchema);
        for (const fact of extracted.facts) {
          const verified = !!fact.quote && fact.quote.trim().split(/\s+/).length <= 25 && quoteInPage(page.text, fact.quote);
          // A page cannot promote itself to an official source merely by saying so.
          facts.push({ ...fact, id: randomUUID(), url: page.url, verified, conflict: false,
            sourceUpdatedAt: fact.sourceUpdatedAt && page.text.includes(fact.sourceUpdatedAt) ? fact.sourceUpdatedAt : undefined,
            quote: verified ? fact.quote : undefined, type: !verified ? "inference" : official(page.url) ? "official" : fact.type === "official" ? "industry" : fact.type });
        }
      }
      const reconciled = reconcileResearchFacts(facts);
      facts.splice(0, facts.length, ...reconciled);
      if (pages.size) {
        const synthesis = await model("propose", { subject: input.subject, allowedKinds: skill.outputKinds, current, facts: reconciled }, ProposeSchema);
        for (const candidate of synthesis.entries) {
          if (!skill.outputKinds.includes(candidate.entry.kind)) { warnings.push(`Bỏ loại tri thức ngoài phạm vi: ${candidate.entry.kind}`); continue; }
          const evidenceFacts = candidate.factIds.map((factId) => reconciled.find((fact) => fact.id === factId));
          if (evidenceFacts.some((fact) => !fact)) { warnings.push("Bỏ đề xuất có mã bằng chứng không tồn tại."); continue; }
          const supported = evidenceFacts as ResearchFact[];
          // Conflicting official facts must travel together; the model cannot silently drop one.
          for (const fact of [...supported]) if (fact.conflict) for (const peer of reconciled.filter((peer) => peer.field === fact.field && peer.conflict)) {
            if (!supported.some((item) => item.id === peer.id)) supported.push(peer);
          }
          const low = supported.some((fact) => !fact.verified || fact.conflict || fact.type === "inference");
          const entry = KnowledgeEntrySchema.parse({ ...candidate.entry,
            evidence: supported.map((fact) => ({ url: fact.url, checkedAt: now().toISOString().slice(0, 10), quote: fact.quote, type: fact.type, sourceUpdatedAt: fact.sourceUpdatedAt })),
            confidence: low ? "low" : candidate.entry.confidence,
            watch: candidate.entry.watch.filter((watch) => pages.has(watch.url)),
            notes: [candidate.entry.notes, `Nghiên cứu ${id}.`, ...supported.filter((fact) => fact.conflict).map((fact) => `Nguồn chính thức mâu thuẫn: ${fact.field} = ${JSON.stringify(fact.value)} (${fact.url})`)].filter(Boolean).join("\n"),
          });
          const result = knowledge.propose(entry, `Nghiên cứu ${id}`, "research", new Map([...pages].map(([url, page]) => [url, page.text]))); proposals.push(result.id);
          if (input.changeEventId) this.db.prepare("UPDATE knowledge_proposals SET change_event_id=? WHERE id=?").run(input.changeEventId, result.id);
        }
        report = `Đã thay đổi: ${synthesis.changed}\nGiữ nguyên: ${synthesis.unchanged}\nChưa xác nhận: ${synthesis.unconfirmed}`;
      } else { status = "unavailable"; report = "Chưa xác nhận được thông tin: không đọc được nguồn công khai phù hợp."; }
    } catch (error) {
      status = error instanceof AppError && error.code === "SELF_IMPROVEMENT_BUDGET_LIMIT" ? "budget_limited" : "failed";
      if (error instanceof LlmError && error.code === "LLM_NOT_CONFIGURED") status = "unavailable";
      report = status === "budget_limited" ? "Đã dừng do đạt hạn mức tự cải tiến trong ngày." : "Nghiên cứu chưa hoàn tất; giữ nguyên tri thức đang áp dụng.";
      if (status === "unavailable") report = "Chưa có model hoặc route phù hợp để nghiên cứu. Kiểm tra cấu hình Mô hình AI; tri thức hiện tại được giữ nguyên.";
      // Never persist raw provider errors, prompts, credentials or response bodies.
    }
    report = redactExportText(`${report}\n${warnings.join("\n")}\nNguồn:\n${[...pages.keys()].map((url) => `- ${url}`).join("\n")}\nĐề xuất: ${proposals.join(", ") || "không có"}`).slice(0, 12_000);
    this.db.prepare("UPDATE research_runs SET status=?,budget_used=?,report=?,proposal_ids=?,details=?,finished_at=? WHERE id=? AND workspace_id IS ?")
      .run(status, JSON.stringify(used), report, JSON.stringify(proposals), JSON.stringify({ facts, pages: [...pages.values()].map(({ text: _text, ...page }) => page) }), now().toISOString(), id, workspace);
    if (input.changeEventId) {
      const row = this.db.prepare("SELECT reaction FROM change_events WHERE id=?").get(input.changeEventId) as { reaction: string };
      const reaction = JSON.parse(row.reaction) as { researchRunIds?: string[] };
      this.db.prepare("UPDATE change_events SET reaction=? WHERE id=?").run(JSON.stringify({ ...reaction, researchRunIds: [...(reaction.researchRunIds ?? []), id].slice(-20) }), input.changeEventId);
    }
    return this.get(id);
  }
}

/** Preserve disagreements, otherwise prefer source quality then the explicit publication date. */
export function reconcileResearchFacts(facts: ResearchFact[]): ResearchFact[] {
  const groups = new Map<string, ResearchFact[]>();
  for (const fact of facts) groups.set(fact.field, [...(groups.get(fact.field) ?? []), fact]);
  return [...groups.values()].flatMap((group) => {
    const official = group.filter((fact) => fact.type === "official" && fact.verified);
    if (new Set(official.map((fact) => JSON.stringify(fact.value))).size > 1) return group.map((fact) => ({ ...fact, conflict: official.includes(fact) }));
    const rank = { official: 3, industry: 2, anecdote: 1, inference: 0 };
    return [...group].sort((a, b) => rank[b.type] - rank[a.type] || (b.sourceUpdatedAt ?? "").localeCompare(a.sourceUpdatedAt ?? "")).slice(0, 1);
  });
}
