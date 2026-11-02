import {
  ResearchNotesSchema,
  ScriptDataSchema,
  ScriptSchema,
  type Project,
  type ResearchNotes,
  type Script,
  type ScriptData,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import {
  computeSectionDurations,
  researchInputHash,
  scriptContentHash,
  scriptInputHash,
} from "../stages/script/scriptUtils.js";

type ScriptRow = {
  data: string;
  origin: "AGENT" | "USER";
  edited: number;
  input_hash: string;
  version: number;
  provider: string | null;
  model: string | null;
  updated_at: string;
  merged_call: number;
};
type ResearchRow = {
  input_hash: string;
  provider: string;
  model: string;
  cached: number;
  created_at: string;
  data: string;
};

export class ScriptService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly repository: JobRepository,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly config: AppConfig,
  ) {}

  get(projectId: string): ScriptData {
    const project = this.repository.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const scriptRow = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
    const researchRow = this.sqlite.prepare("SELECT * FROM research_notes WHERE project_id = ?").get(projectId) as ResearchRow | undefined;
    const researchInput = researchRow ? JSON.parse(researchRow.data) as ResearchNotes : undefined;
    const script = scriptRow ? {
      data: ScriptSchema.parse(JSON.parse(scriptRow.data) as unknown),
      origin: scriptRow.origin,
      edited: Boolean(scriptRow.edited),
      version: scriptRow.version,
      provider: scriptRow.provider,
      model: scriptRow.model,
      updatedAt: scriptRow.updated_at,
    } : null;
    const research = researchRow ? {
      data: researchInput,
      provider: researchRow.provider,
      model: researchRow.model,
      cached: Boolean(researchRow.cached),
      createdAt: researchRow.created_at,
    } : null;
    const researchMode = project.settings.researchMode ?? this.config.LLM_RESEARCH_MODE;
    const currentResearchHash = researchMode !== "off" ? researchRow?.input_hash : undefined;
    const currentInputHash = researchMode === "merged" && scriptRow?.merged_call
      && researchRow?.input_hash === researchInputHash(project)
      ? researchRow.input_hash
      : scriptInputHash(project, currentResearchHash);
    const stage = this.repository.getStage(projectId, "SCRIPT");
    return ScriptDataSchema.parse({
      script,
      research,
      origin: script?.origin ?? null,
      version: script?.version ?? 0,
      stale: script !== null && (scriptRow?.input_hash !== currentInputHash || stage.state === "STALE"),
    });
  }

  save(projectId: string, input: unknown): ScriptData {
    const script = ScriptSchema.parse(input);
    return this.repository.atomic(() => {
      const project = this.repository.getProject(projectId);
      if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
      if (this.repository.getActiveJob(projectId)) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
      }

      const normalized = computeSectionDurations(script, this.config.SPEECH_WORDS_PER_MINUTE);
      const existing = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
      const changed = !existing || scriptContentHash(ScriptSchema.parse(JSON.parse(existing.data) as unknown)) !== scriptContentHash(normalized);
      const version = (existing?.version ?? 0) + (changed ? 1 : 0);
      const origin = existing?.origin ?? "USER";
      const edited = origin === "AGENT" ? true : Boolean(existing?.edited);
      const research = this.sqlite.prepare("SELECT input_hash FROM research_notes WHERE project_id = ?")
        .get(projectId) as { input_hash: string } | undefined;
      const researchMode = project.settings.researchMode ?? this.config.LLM_RESEARCH_MODE;
      const currentResearchHash = researchMode !== "off" ? research?.input_hash : undefined;
      const inputHash = scriptInputHash(project, currentResearchHash);
      const updatedAt = new Date().toISOString();
      this.sqlite.prepare(
        "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, false) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, origin = excluded.origin, edited = excluded.edited, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = false",
      ).run(
        projectId,
        JSON.stringify(normalized),
        origin,
        edited ? 1 : 0,
        inputHash,
        version,
        existing?.provider ?? null,
        existing?.model ?? null,
        updatedAt,
      );

      const scriptStage = this.repository.getStage(projectId, "SCRIPT");
      if (scriptStage.state !== "DONE") {
        this.orchestrator.completeByUser(projectId, "SCRIPT", { skip: ["RESEARCH"] });
      } else if (changed) {
        markStaleFrom(this.repository, projectId, "SCRIPT");
      }
      return this.get(projectId);
    });
  }

  saveResearch(projectId: string, input: unknown): ScriptData {
    const research = ResearchNotesSchema.parse(input);
    return this.repository.atomic(() => {
      const project = this.repository.getProject(projectId);
      if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
      if (this.repository.getActiveJob(projectId)) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
      }

      const previous = this.sqlite.prepare("SELECT data FROM research_notes WHERE project_id = ?")
        .get(projectId) as { data: string } | undefined;
      const changed = !previous || JSON.stringify(ResearchNotesSchema.parse(JSON.parse(previous.data) as unknown)) !== JSON.stringify(research);
      this.sqlite.prepare(
        "INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, ?, 'user', 'user', false, ?, ?) ON CONFLICT(project_id) DO UPDATE SET input_hash = excluded.input_hash, provider = excluded.provider, model = excluded.model, cached = false, created_at = excluded.created_at, data = excluded.data",
      ).run(
        projectId,
        researchInputHash(project),
        new Date().toISOString(),
        JSON.stringify(research),
      );
      this.orchestrator.completeByUser(projectId, "RESEARCH", { invalidate: changed });
      return this.get(projectId);
    });
  }
}
