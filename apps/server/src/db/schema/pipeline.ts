// TASK-085: tables for the pipeline domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { ProjectSettings, ThumbnailMeta, ClipProposal, ReframeMode } from "@vg/shared";
import { user } from "./auth.js";
import { nodes } from "./nodes.js";
import { profiles } from "./profiles.js";

export const projects = sqliteTable("projects", {
  executionMode: text("execution_mode", { enum: ["control", "node"] }).notNull().default("control"),
  executionNode: text("execution_node").references((): AnySQLiteColumn => nodes.id, { onDelete: "set null" }),
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  topic: text("topic").notNull(),
  mode: text("mode").notNull(),
  runMode: text("run_mode"),
  settings: text("settings", { mode: "json" }).$type<ProjectSettings>().notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  thumbnailPath: text("thumbnail_path"),
  coverPath: text("cover_path"),
  thumbnailMeta: text("thumbnail_meta", { mode: "json" }).$type<ThumbnailMeta | null>(),
  durationSec: integer("duration_sec"),
  version: integer("version").notNull().default(1),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  /** long | clip | translation. Clips and translations point at a parent when one exists. */
  kind: text("kind").notNull().default("long"),
  parentProjectId: text("parent_project_id").references((): AnySQLiteColumn => projects.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
}, (table) => [
  index("projects_workspace_idx").on(table.workspaceId),
  index("projects_status_idx").on(table.status),
  index("projects_updated_at_idx").on(table.updatedAt),
  index("projects_archived_at_idx").on(table.archivedAt),
  index("projects_profile_id_idx").on(table.profileId),
  index("projects_parent_project_id_idx").on(table.parentProjectId),
]);

export type ProjectRow = typeof projects.$inferSelect;

/** TASK-135a: a fenced segment of a project executed by one worker. */
export const projectRuns = sqliteTable("project_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  nodeId: text("node_id").notNull().references((): AnySQLiteColumn => nodes.id),
  leaseId: text("lease_id").notNull(),
  leaseUntil: text("lease_until").notNull(),
  heartbeatAt: text("heartbeat_at").notNull(),
  status: text("status", { enum: ["GRANTED", "RUNNING", "PAUSED_AT_GATE", "DONE", "LOST", "CANCELLED", "FAILED"] }).notNull(),
  fromStage: text("from_stage").notNull(),
  stopBefore: text("stop_before").notNull(),
  baseVersion: text("base_version").notNull(),
  lastSeq: integer("last_seq").notNull().default(0),
  budgetCapUsd: real("budget_cap_usd").notNull(),
  createdAt: text("created_at").notNull(),
  endedAt: text("ended_at"),
  endReason: text("end_reason"),
}, (table) => [index("project_runs_project_status_idx").on(table.projectId, table.status), index("project_runs_node_lease_idx").on(table.nodeId, table.leaseUntil)]);

export const runCheckpoints = sqliteTable("run_checkpoints", {
  runId: text("run_id").notNull().references(() => projectRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  stage: text("stage").notNull(),
  inputVersion: text("input_version").notNull(),
  appliedAt: text("applied_at").notNull(),
  rows: integer("rows").notNull(),
  bytes: integer("bytes").notNull(),
  result: text("result", { enum: ["applied", "rebase", "rejected"] }).notNull(),
  contentHash: text("content_hash").notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.seq] })]);

export const runUploads = sqliteTable("run_uploads", {
  runId: text("run_id").notNull().references(() => projectRuns.id, { onDelete: "cascade" }),
  leaseId: text("lease_id").notNull(),
  name: text("name").notNull(),
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  receivedBytes: integer("received_bytes").notNull().default(0),
  status: text("status", { enum: ["partial", "ready", "linked"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.leaseId, table.name] })]);

/** One proposal batch for Shorts/Reels cut from a long render or an external file. */
export const clipSets = sqliteTable("clip_sets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["project", "external"] }).notNull(),
  externalPath: text("external_path"),
  title: text("title").notNull().default(""),
  ownershipConfirmed: integer("ownership_confirmed", { mode: "boolean" }).notNull().default(false),
  options: text("options", { mode: "json" }).$type<{
    count: number;
    minSec: number;
    maxSec: number;
    reframe: ReframeMode;
    platform?: string;
  }>().notNull(),
  proposals: text("proposals", { mode: "json" }).$type<ClipProposal[]>().notNull(),
  status: text("status", { enum: ["proposed", "exporting", "done"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("clip_sets_project_idx").on(table.projectId),
]);

export type ClipSetRow = typeof clipSets.$inferSelect;

export const jobs = sqliteTable("jobs", {
  inputVersion: text("input_version"),
  invalidatedAt: text("invalidated_at"),
  inputRetry: integer("input_retry", { mode: "boolean" }).notNull().default(false),
  finalizingAt: text("finalizing_at"),
  executor: text("executor").notNull().default("app"),
  handoffReason: text("handoff_reason"),
  handoffAt: text("handoff_at"),
  agentInstance: text("agent_instance"),
  /** TASK-147d: failed script submits counted for the lease in agentHoldLeaseId; a new lease resets it. */
  agentHoldCount: integer("agent_hold_count"),
  agentHoldLeaseId: text("agent_hold_lease_id"),
  id: text("id").primaryKey(),
  /** Null for assistant-chat usage, which is not tied to one video. */
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  scope: text("scope"),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  message: text("message"),
  attempt: integer("attempt").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  error: text("error", { mode: "json" }).$type<{ code: string; message: string; retryable: boolean; retryAt?: string } | null>(),
  usage: text("usage", { mode: "json" }).$type<{
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    features?: Record<string, number>;
    calls?: {
      task: string;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      premiumRequests?: number;
      cached: boolean;
      fallback: boolean;
      fallbackReason?: "quota";
      ok: boolean;
      characters?: number;
      costUsd?: number;
    }[];
  } | null>(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  runAfter: text("run_after").notNull(),
  previousState: text("previous_state").notNull().default("PENDING"),
  /** TASK-118: the worker node that holds this job. Null means the main machine. */
  nodeId: text("node_id"),
  /** Fencing token of the current lease. A node that sends another id gets 409. */
  leaseId: text("lease_id"),
  leaseUntil: text("lease_until"),
  heartbeatAt: text("heartbeat_at"),
  /** TASK-125: set when the stage passes its limit. The job keeps running; nothing kills it by the clock. */
  overdueAt: text("overdue_at"),
  nextCheckAt: text("next_check_at"),
  /** checking | waiting_decision */
  overdueState: text("overdue_state"),
}, (table) => [
  index("jobs_status_run_after_idx").on(table.status, table.runAfter),
  index("jobs_project_created_idx").on(table.projectId, table.createdAt),
  index("jobs_node_lease_idx").on(table.nodeId, table.leaseUntil),
  index("jobs_stage_status_finished_idx").on(table.stage, table.status, table.finishedAt),
]);

/** TASK-125: one row per check of an overdue stage, and per decision by Hermes or the user. */
export const stageOverdueChecks = sqliteTable("stage_overdue_checks", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  attempt: integer("attempt").notNull(),
  projectId: text("project_id").notNull(),
  workspaceId: text("workspace_id"),
  stage: text("stage").notNull(),
  checkNo: integer("check_no").notNull(),
  at: text("at").notNull(),
  facts: text("facts", { mode: "json" }),
  action: text("action").notNull(),
  extendMs: integer("extend_ms"),
  /** ladder | llm | override | hermes | user */
  source: text("source").notNull(),
  actor: text("actor"),
  reason: text("reason").notNull(),
  costUsd: real("cost_usd").notNull().default(0),
}, (table) => [
  index("stage_overdue_checks_job_idx").on(table.jobId, table.attempt),
  index("stage_overdue_checks_workspace_idx").on(table.workspaceId, table.at),
]);

export const projectStages = sqliteTable("project_stages", {
  inputVersion: text("input_version"),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  state: text("state").notNull(),
  progress: integer("progress").notNull().default(0),
  message: text("message"),
  jobId: text("job_id"),
  updatedAt: text("updated_at").notNull(),
  error: text("error", { mode: "json" }).$type<{ code: string; message: string; retryable: boolean; retryAt?: string } | null>(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.stage] }),
  index("project_stages_state_idx").on(table.projectId, table.state),
]);

export const researchNotes = sqliteTable("research_notes", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  cached: integer("cached", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});

export const scripts = sqliteTable("scripts", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull(),
  origin: text("origin").notNull(),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  inputHash: text("input_hash").notNull(),
  version: integer("version").notNull().default(1),
  provider: text("provider"),
  model: text("model"),
  updatedAt: text("updated_at").notNull(),
  mergedCall: integer("merged_call", { mode: "boolean" }).notNull().default(false),
  reviewNotes: text("review_notes", { mode: "json" }).$type<string[] | null>(),
  qualityScore: real("quality_score"),
  blockingFacts: integer("blocking_facts").notNull().default(0),
  reviseRound: integer("revise_round").notNull().default(0),
});

export const scriptDrafts = sqliteTable("script_drafts", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  outline: text("outline", { mode: "json" }),
  hookCandidates: text("hook_candidates", { mode: "json" }),
  critique: text("critique", { mode: "json" }),
  critiqueHistory: text("critique_history", { mode: "json" }),
  engineMode: text("engine_mode").notNull(),
  inputHash: text("input_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** TASK-147d: "agent:<instance>" when an agent wrote the draft; null when the app did. */
  author: text("author"),
  /** TASK-146 outline mode: "outline_ready" while parked for approval, "outline_approved" on resume, "done" after finish; null when never parked. */
  phase: text("phase"),
});

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  kind: text("kind").notNull(),
  sectionId: text("section_id"),
  label: text("label").notNull(),
  narration: text("narration").notNull(),
  visualNotes: text("visual_notes").notNull(),
  visualDescription: text("visual_description").notNull().default(""),
  noVisual: integer("no_visual", { mode: "boolean" }).notNull().default(false),
  visualQueries: text("visual_queries", { mode: "json" }).$type<{ primary: string; alternatives: string[] }>().notNull(),
  musicMood: text("music_mood").notNull(),
  energy: text("energy").notNull(),
  estDurationSec: real("est_duration_sec").notNull(),
  durationOverrideSec: real("duration_override_sec"),
  startSec: real("start_sec").notNull(),
  transitionNote: text("transition_note").notNull(),
  origin: text("origin").notNull(),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  inputHash: text("input_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("scenes_project_order_uq").on(table.projectId, table.order),
  index("scenes_project_idx").on(table.projectId),
]);

export const voiceTracks = sqliteTable("voice_tracks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  voice: text("voice").notNull(),
  rate: text("rate").notNull(),
  origin: text("origin", { enum: ["AGENT", "USER"] }).notNull(),
  audioPath: text("audio_path").notNull(),
  durationSec: real("duration_sec").notNull(),
  cues: text("cues", { mode: "json" }).$type<Array<{ startSec: number; endSec: number; text: string }>>().notNull().default([]),
  words: text("words", { mode: "json" }).$type<Array<{ startSec: number; endSec: number; text: string }>>().notNull().default([]),
  timingSource: text("timing_source").notNull().default("estimated"),
  inputHash: text("input_hash").notNull(),
  narrationHash: text("narration_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("voice_tracks_scene_uq").on(table.sceneId),
  index("voice_tracks_project_idx").on(table.projectId),
]);

export const subtitleTracks = sqliteTable("subtitle_tracks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  cues: text("cues", { mode: "json" }).$type<Array<{ index?: number; sceneId?: string; startSec: number; endSec: number; text: string; edited?: boolean }>>().notNull().default([]),
  srtPath: text("srt_path").notNull(),
  assPath: text("ass_path").notNull(),
  inputHash: text("input_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("subtitle_tracks_project_uq").on(table.projectId),
]);

export const musicCandidates = sqliteTable("music_candidates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerItemId: text("provider_item_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist"),
  sourceUrl: text("source_url"),
  audioUrl: text("audio_url"),
  durationSec: real("duration_sec"),
  genres: text("genres", { mode: "json" }).$type<string[]>().notNull().default([]),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  license: text("license", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  relevanceScore: real("relevance_score").notNull().default(0),
  scoreBreakdown: text("score_breakdown", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
  rank: integer("rank").notNull().default(0),
  localPath: text("local_path"),
  inputHash: text("input_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("music_candidates_project_idx").on(table.projectId),
  uniqueIndex("music_candidates_item_uq").on(table.projectId, table.provider, table.providerItemId),
]);

export const musicSelections = sqliteTable("music_selections", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  candidateId: text("candidate_id").references(() => musicCandidates.id, { onDelete: "set null" }),
  status: text("status", { enum: ["REVIEW_REQUIRED", "APPROVED", "NONE"] }).notNull(),
  selectedBy: text("selected_by", { enum: ["AGENT", "USER"] }).notNull(),
  volume: real("volume").notNull(),
  fadeInSec: real("fade_in_sec").notNull().default(2),
  fadeOutSec: real("fade_out_sec").notNull().default(3),
  duckingDb: real("ducking_db").notNull().default(-12),
  startOffsetSec: real("start_offset_sec").notNull().default(0),
  queryOverride: text("query_override"),
  searchHash: text("search_hash").notNull().default(""),
  assist: text("assist", { mode: "json" }).$type<Record<string, unknown> | null>(),
  updatedAt: text("updated_at").notNull(),
});

export const videoMetadata = sqliteTable("video_metadata", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  draft: text("draft", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  edited: text("edited", { mode: "json" }).$type<Record<string, unknown> | null>(),
  source: text("source", { enum: ["LLM", "CODE"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const timelineSnapshots = sqliteTable("timeline_snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  source: text("source", { enum: ["chat", "assistant", "mcp", "manual"] }).notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("timeline_snapshots_project_idx").on(table.projectId, table.createdAt),
]);

export const timelines = sqliteTable("timelines", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  inputHash: text("input_hash").notNull(),
  totalDurationSec: real("total_duration_sec").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Latest evidence per project. Dismissal history is retained inside manifest JSON. */
export const sourceManifests = sqliteTable("source_manifests", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  renderId: text("render_id"),
  manifest: text("manifest", { mode: "json" }).$type<import("@vg/shared").SourceManifest>().notNull(),
  scores: text("scores", { mode: "json" }).$type<import("@vg/shared").OriginalityScores>().notNull(),
  verdict: text("verdict", { enum: ["OK", "REVIEW"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("source_manifests_project_uq").on(table.projectId)]);

export const guidelineFindings = sqliteTable("guideline_findings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["SCRIPT", "TIMELINE"] }).notNull(),
  source: text("source", { enum: ["CODE", "LLM"] }).notNull(),
  ruleId: text("rule_id").notNull(),
  severity: text("severity", { enum: ["MUST", "SHOULD", "TIP"] }).notNull(),
  sceneId: text("scene_id"),
  text: text("text").notNull(),
  quote: text("quote"),
  suggestion: text("suggestion"),
  status: text("status", { enum: ["OPEN", "FIXED", "DISMISSED"] }).notNull().default("OPEN"),
  dismissedBy: text("dismissed_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("guideline_findings_project_idx").on(table.projectId),
]);

export const renders = sqliteTable("renders", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  status: text("status", { enum: ["DONE", "FAILED"] }).notNull(),
  outputPath: text("output_path").notNull(),
  creditsPath: text("credits_path"),
  srtPath: text("srt_path"),
  durationSec: real("duration_sec").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  report: text("report", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
  version: integer("version").notNull().default(0),
  note: text("note"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
  reviewThreadId: text("review_thread_id"),
  metadataSnapshot: text("metadata_snapshot", { mode: "json" }).$type<Record<string, unknown> | null>(),
  /** Null = project default aspect. */
  aspectRatio: text("aspect_ratio", { enum: ["16:9", "9:16", "1:1"] }),
  variantOf: text("variant_of"),
}, (table) => [
  index("renders_project_created_idx").on(table.projectId, table.createdAt),
]);

export const reviewThreads = sqliteTable("review_threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contextHash: text("context_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("review_threads_project_idx").on(table.projectId),
]);

export const reviewMessages = sqliteTable("review_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => reviewThreads.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  proposals: text("proposals", { mode: "json" }).$type<unknown[] | null>(),
  usage: text("usage", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("review_messages_thread_idx").on(table.threadId),
  index("review_messages_project_idx").on(table.projectId),
]);

export const reviewProposalApplications = sqliteTable("review_proposal_applications", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => reviewMessages.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  proposalIndex: integer("proposal_index").notNull(),
  result: text("result", { mode: "json" }).$type<Record<string, unknown> | null>(),
  appliedAt: text("applied_at").notNull(),
}, (table) => [
  index("review_proposal_applications_message_idx").on(table.messageId),
  uniqueIndex("review_proposal_applications_uq").on(table.messageId, table.proposalIndex),
]);

/** One row per quality repair action the agent or the default ladder ran (TASK-121). */
export const qualityRepairs = sqliteTable("quality_repairs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  profileId: text("profile_id"),
  gate: text("gate").notNull(),
  issueKind: text("issue_kind").notNull(),
  sceneId: text("scene_id"),
  action: text("action").notNull(),
  chosenBy: text("chosen_by", { enum: ["agent", "ladder"] }).notNull(),
  attempt: integer("attempt").notNull(),
  costUsd: real("cost_usd").notNull().default(0),
  renderUsed: integer("render_used").notNull().default(0),
  /** pending until the next gate check; then passed, failed or error. */
  outcome: text("outcome").notNull().default("pending"),
  gateBefore: text("gate_before", { mode: "json" }).$type<unknown>(),
  gateAfter: text("gate_after", { mode: "json" }).$type<unknown>(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("quality_repairs_project_idx").on(table.projectId, table.createdAt),
  index("quality_repairs_profile_idx").on(table.profileId, table.issueKind),
]);

/** TASK-148e: prompt variants per stage. Only the user can promote one; trial evidence is stored with it. */
export const stagePromptVariants = sqliteTable("stage_prompt_variants", {
  id: text("id").primaryKey(),
  stage: text("stage").notNull(),
  textHash: text("text_hash").notNull(),
  text: text("text").notNull(),
  status: text("status").notNull(),
  evidence: text("evidence", { mode: "json" }).$type<unknown[]>().notNull().default([]),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
}, (table) => [uniqueIndex("stage_prompt_variants_stage_hash").on(table.stage, table.textHash)]);

// TASK-148a: user edits and gate rejections, and distilled per-stage notes.
export const stageFeedback = sqliteTable("stage_feedback", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  profileId: text("profile_id"),
  stage: text("stage").notNull(),
  kind: text("kind").notNull(),
  target: text("target").notNull(),
  before: text("before"),
  after: text("after"),
  reason: text("reason"),
  source: text("source").notNull(),
  distilledAt: text("distilled_at"),
}, (table) => [
  index("stage_feedback_project_stage_idx").on(table.projectId, table.stage),
  index("stage_feedback_profile_stage_idx").on(table.profileId, table.stage, table.createdAt),
]);

/** TASK-148c: one row per finished stage run (written once, in the orchestrator completion path). */
export const stageQuality = sqliteTable("stage_quality", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  profileId: text("profile_id"),
  stage: text("stage").notNull(),
  jobId: text("job_id"),
  executor: text("executor").notNull().default("app"),
  modelRoute: text("model_route"),
  retries: integer("retries").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  /** Stage-specific numbers, e.g. { quality_score } for SCRIPT. */
  metrics: text("metrics", { mode: "json" }).$type<Record<string, number | string | boolean | null>>().notNull(),
}, (table) => [
  index("stage_quality_stage_created_idx").on(table.stage, table.profileId, table.createdAt),
]);

export const stageNotes = sqliteTable("stage_notes", {
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  stage: text("stage").notNull(),
  text: text("text").notNull(),
  evidenceIds: text("evidence_ids", { mode: "json" }).$type<string[]>().notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
  uses: integer("uses").notNull().default(0),
  lastUsedAt: text("last_used_at"),
}, (table) => [
  index("stage_notes_profile_stage_status_idx").on(table.profileId, table.stage, table.status),
]);
