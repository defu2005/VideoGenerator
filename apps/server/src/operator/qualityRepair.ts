import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  PROTECTED_PROJECT_ID,
  RENDER_ACTIONS,
  RepairChoiceSchema,
  localDateString,
  nextLadderAction,
  repairActionsFor,
  renderGateOk,
  scriptGateDecision,
  type RepairActionKind,
  type RepairChoice,
  type RepairGate,
  type RepairIssue,
  type RepairIssueKind,
  type RepairSettings,
  type RepairStatsByIssue,
} from "@vg/shared";
import type { AssistantToolContext } from "../assistant/tools.js";
import { LlmCache } from "../providers/llm/cache.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { systemActorFor } from "../auth/workspaces.js";
import { invokeRegistryTool } from "../registry/invoke.js";
import { logToolAudit } from "../registry/audit.js";
import { createUserRequest } from "./autopilot.js";
import { effectiveAutonomy, repairSettingsFor } from "./autonomy.js";
import { autonomyBudgetStatus, readAutonomyBudget } from "./autonomyBudget.js";
import { recordHeld, renderGateInputs, scriptGateInputs, writeScriptRepairHint } from "./qualityGates.js";

/**
 * TASK-121. Code owns the facts and the limits; the agent only picks one action per issue from a fixed list.
 * One call to `repairStep` is one repair round. A round that starts a job (script, voice, render...) returns
 * `repairing` and the next approve_gate call checks the result with the same gate.
 */

export type SceneView = {
  sceneId: string;
  order: number;
  startSec: number;
  durationSec: number;
  noVisual: boolean;
  owned: boolean;
  reason: string | null;
  hasPassingAlternative: boolean;
  selectedBy: string | null;
  candidateId: string | null;
};

export type RepairVisuals = {
  repairSceneView: (projectId: string) => SceneView[];
  repairWebAllowed: () => boolean;
};

export type RepairEnv = {
  ctx: AssistantToolContext;
  /** Tests inject a fake. Production builds a VisualService. */
  visuals?: RepairVisuals;
  /** Tests inject a chooser instead of calling a model. */
  chooser?: (input: { issues: RepairIssue[]; tried: Record<string, string[]>; remaining: RepairRemaining }) => Promise<RepairChoice>;
  now?: () => Date;
};

export type RepairRemaining = { attempts: number; renders: number; usd: number | null };

type RepairRow = {
  id: string;
  gate: RepairGate;
  issue_kind: RepairIssueKind;
  scene_id: string | null;
  action: RepairActionKind;
  chosen_by: "agent" | "ladder";
  attempt: number;
  cost_usd: number;
  render_used: number;
  outcome: string;
  gate_before: string | null;
  gate_after: string | null;
  created_at: string;
};

export type RepairStepResult =
  | { status: "off" }
  | { status: "passed" }
  | { status: "repairing"; attempt: number; maxAttempts: number; actions: Array<{ kind: RepairIssueKind; action: RepairActionKind; by: "agent" | "ladder" }>; sync: boolean }
  | { status: "exhausted"; reason: string; handled: "shelved" | "asked" | "breaker" };

const MAX_SYNC_ROUNDS = 20;
const BREAKER_MS = 60 * 60 * 1000;

const GATE_OF: Record<string, RepairGate | undefined> = { SCRIPT: "SCRIPT", VISUAL_REVIEW: "VISUALS", RENDER: "RENDER" };

/** The quality gate a pipeline gate name maps to. Other gates are not repaired. */
export function repairGateFor(gate: string): RepairGate | null {
  return GATE_OF[gate] ?? null;
}

/** Whether this project may use the repair loop at all (grant on, not the protected project). */
export function repairEnabled(sqlite: Database.Database, projectId: string): boolean {
  if (projectId === PROTECTED_PROJECT_ID) return false;
  return effectiveAutonomy(sqlite, { projectId }).grants.retries;
}

function projectRow(sqlite: Database.Database, projectId: string) {
  return sqlite.prepare("SELECT id, title, topic, profile_id AS profileId, status, settings FROM projects WHERE id = ?")
    .get(projectId) as { id: string; title: string; topic: string; profileId: string | null; status: string; settings: string } | undefined;
}

// ---------------------------------------------------------------- diagnose

function sceneIssueKind(reason: string | null): RepairIssueKind | null {
  switch (reason) {
    case "vision_reject": return "scene_vision_reject";
    case "vision_missing": return "scene_vision_missing";
    case "lowRelevance": case "no_candidate": return "scene_low_relevance";
    case "source_risk": case "invalid_source": return "scene_source_risk";
    default: return null;
  }
}

const SCENE_DETAIL: Partial<Record<RepairIssueKind, string>> = {
  scene_vision_reject: "ảnh bị vision loại",
  scene_vision_missing: "ảnh chưa được vision kiểm",
  scene_low_relevance: "ảnh ít liên quan",
  scene_source_risk: "nguồn ảnh có rủi ro",
};

function sceneAt(scenes: SceneView[], second: number): SceneView | undefined {
  return scenes.find((scene) => second >= scene.startSec && second < scene.startSec + Math.max(scene.durationSec, 0.1))
    ?? [...scenes].reverse().find((scene) => scene.startSec <= second);
}

export function diagnose(
  sqlite: Database.Database,
  projectId: string,
  gate: RepairGate,
  visuals?: RepairVisuals,
  options: { maxRevise?: number } = {},
): RepairIssue[] {
  const issues: RepairIssue[] = [];
  if (gate === "SCRIPT") {
    const input = scriptGateInputs(sqlite, projectId);
    if (scriptGateDecision(input, options.maxRevise ?? 99) === "approve") return [];
    if (input.blockingFacts > 0) {
      issues.push({ gate, kind: "script_facts", detail: `${input.blockingFacts} điểm fact chưa vững`, actions: repairActionsFor("script_facts") });
    }
    if (!input.guidelinePass) {
      issues.push({ gate, kind: "script_guideline", detail: "vi phạm định hướng nội dung (MUST)", actions: repairActionsFor("script_guideline") });
    }
    if (input.score == null || input.score < input.minQualityScore) {
      issues.push({
        gate, kind: "script_score",
        detail: input.score == null ? "chưa có điểm kịch bản" : `kịch bản ${input.score}/${input.minQualityScore}`,
        actions: repairActionsFor("script_score"),
      });
    }
    return issues;
  }
  if (gate === "VISUALS") {
    if (!visuals) return [];
    const webAllowed = visuals.repairWebAllowed();
    const groups = new Map<RepairIssueKind, SceneView[]>();
    for (const scene of visuals.repairSceneView(projectId)) {
      if (scene.owned || scene.noVisual) continue;
      const kind = sceneIssueKind(scene.reason);
      if (!kind) continue;
      groups.set(kind, [...(groups.get(kind) ?? []), scene]);
    }
    for (const [kind, scenes] of groups) {
      issues.push({
        gate, kind, sceneIds: scenes.map((scene) => scene.sceneId),
        detail: `${scenes.length} cảnh: ${SCENE_DETAIL[kind] ?? kind}`,
        actions: repairActionsFor(kind, { hasPassingCandidate: scenes.some((scene) => scene.hasPassingAlternative), webAllowed }),
      });
    }
    return issues;
  }
  // RENDER
  const input = renderGateInputs(sqlite, projectId);
  if (renderGateOk(input)) return [];
  if (!input.exists) {
    issues.push({ gate, kind: "file_missing", detail: input.failed.includes("chưa có video") ? "chưa có video" : "không thấy file video", actions: repairActionsFor("file_missing") });
  }
  if (input.exists && input.silent) issues.push({ gate, kind: "audio_silent", detail: "âm thanh im", actions: repairActionsFor("audio_silent") });
  if (input.exists && !input.subtitlesInSync) issues.push({ gate, kind: "subtitle_sync", detail: "phụ đề lệch", actions: repairActionsFor("subtitle_sync") });
  if (input.exists && input.targetSec > 0) {
    const ratio = input.durationSec / input.targetSec;
    if (ratio > 1.15) issues.push({ gate, kind: "duration_long", detail: `video dài ${Math.round(ratio * 100)}% mục tiêu`, actions: repairActionsFor("duration_long") });
    else if (ratio < 0.85) issues.push({ gate, kind: "duration_short", detail: `video ngắn ${Math.round(ratio * 100)}% mục tiêu`, actions: repairActionsFor("duration_short") });
  }
  const times = renderSegmentTimes(sqlite, projectId);
  const scenes = visuals ? visuals.repairSceneView(projectId) : [];
  const webAllowed = visuals ? visuals.repairWebAllowed() : false;
  for (const [kind, count, at] of [
    ["freeze", input.freezeSegments, times.freeze], ["black", input.blackSegments, times.black],
  ] as const) {
    if (count <= 0) continue;
    const hit = at.map((second) => sceneAt(scenes, second)).filter((scene): scene is SceneView => Boolean(scene) && !scene!.owned);
    const sceneIds = [...new Set(hit.map((scene) => scene.sceneId))];
    issues.push({
      gate, kind, ...(sceneIds.length ? { sceneIds } : {}),
      detail: kind === "freeze" ? `${count} đoạn đứng hình` : `${count} đoạn đen`,
      actions: sceneIds.length
        ? repairActionsFor(kind, { hasPassingCandidate: hit.some((scene) => scene.hasPassingAlternative), webAllowed })
        : ["rebuild_timeline"],
    });
  }
  return issues;
}

function renderSegmentTimes(sqlite: Database.Database, projectId: string): { freeze: number[]; black: number[] } {
  const row = sqlite.prepare(
    "SELECT report FROM renders WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).get(projectId) as { report: string } | undefined;
  try {
    const report = JSON.parse(row?.report ?? "{}") as { freezeAtSec?: number[]; blackAtSec?: number[] };
    return { freeze: report.freezeAtSec ?? [], black: report.blackAtSec ?? [] };
  } catch {
    return { freeze: [], black: [] };
  }
}

/** Numbers that make up the gate input. Used for the loop guard and the log. */
export function gateSnapshot(sqlite: Database.Database, projectId: string, gate: RepairGate, issues: RepairIssue[]) {
  const base = {
    gate,
    issues: issues.map((issue) => ({ kind: issue.kind, sceneIds: [...(issue.sceneIds ?? [])].sort(), detail: issue.detail })),
  };
  if (gate === "SCRIPT") {
    const input = scriptGateInputs(sqlite, projectId);
    return { ...base, score: input.score, blockingFacts: input.blockingFacts, guidelinePass: input.guidelinePass };
  }
  if (gate === "RENDER") {
    const input = renderGateInputs(sqlite, projectId);
    return { ...base, durationSec: Math.round(input.durationSec), failed: input.failed };
  }
  return base;
}

export function snapshotHash(snapshot: unknown): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------- log + stats

function resetAt(sqlite: Database.Database, projectId: string): string {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(`repair.reset.${projectId}`) as { value: string } | undefined;
  return row?.value ?? "";
}

function rowsSince(sqlite: Database.Database, projectId: string): RepairRow[] {
  return sqlite.prepare("SELECT * FROM quality_repairs WHERE project_id = ? AND created_at > ? ORDER BY created_at, rowid")
    .all(projectId, resetAt(sqlite, projectId)) as RepairRow[];
}

export function listRepairLog(sqlite: Database.Database, projectId: string) {
  const rows = rowsSince(sqlite, projectId);
  const attempts = new Set(rows.map((row) => row.attempt)).size;
  const renders = new Set(rows.filter((row) => row.render_used > 0).map((row) => row.attempt)).size;
  const sceneChanges = new Set(rows.filter((row) => row.scene_id && row.outcome !== "error").map((row) => row.scene_id)).size;
  const settings = projectRow(sqlite, projectId)?.profileId !== undefined
    ? repairSettingsFor(sqlite, projectRow(sqlite, projectId)?.profileId) : null;
  return {
    attempts, renders, sceneChanges, maxAttempts: settings?.maxAttemptsPerProject ?? 0,
    rows: rows.map((row) => ({
      id: row.id, gate: row.gate, issueKind: row.issue_kind, sceneId: row.scene_id, action: row.action,
      chosenBy: row.chosen_by, attempt: row.attempt, costUsd: row.cost_usd, renderUsed: row.render_used > 0,
      outcome: row.outcome, createdAt: row.created_at,
    })),
  };
}

/** What worked before on this channel, per issue kind and action. */
export function repairStats(sqlite: Database.Database, profileId: string | null, days = 90, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = sqlite.prepare(`SELECT issue_kind AS kind, action, COUNT(*) AS tries,
      SUM(CASE WHEN outcome = 'passed' THEN 1 ELSE 0 END) AS passed, AVG(cost_usd) AS avgCost
    FROM quality_repairs WHERE (? IS NULL OR profile_id = ?) AND created_at >= ? AND outcome IN ('passed', 'failed')
    GROUP BY issue_kind, action`).all(profileId, profileId, since) as Array<{ kind: RepairIssueKind; action: RepairActionKind; tries: number; passed: number; avgCost: number }>;
  const byIssue: RepairStatsByIssue = {};
  for (const row of rows) {
    byIssue[row.kind] = { ...(byIssue[row.kind] ?? {}), [row.action]: { tries: row.tries, passed: row.passed } };
  }
  return { rows, byIssue };
}

function resolvePending(sqlite: Database.Database, projectId: string, gate: RepairGate, issues: RepairIssue[], snapshot: unknown): void {
  const pending = rowsSince(sqlite, projectId).filter((row) => row.gate === gate && row.outcome === "pending");
  for (const row of pending) {
    const stillThere = issues.some((issue) => issue.kind === row.issue_kind
      && (!row.scene_id || (issue.sceneIds ?? []).includes(row.scene_id)));
    sqlite.prepare("UPDATE quality_repairs SET outcome = ?, gate_after = ? WHERE id = ?")
      .run(stillThere ? "failed" : "passed", JSON.stringify(snapshot), row.id);
  }
}

// ---------------------------------------------------------------- budget

function rendersLeftToday(sqlite: Database.Database, profileId: string | null, now: Date): number {
  const day = localDateString(now, "Asia/Ho_Chi_Minh");
  const caps = [readAutonomyBudget(sqlite).maxRendersPerDay, profileId ? readAutonomyBudget(sqlite, profileId).maxRendersPerDay : null]
    .filter((cap): cap is number => typeof cap === "number");
  if (!caps.length) return Infinity;
  const used = (sqlite.prepare("SELECT COUNT(*) AS n FROM autonomy_job_claims WHERE day = ? AND stage = 'RENDER'").get(day) as { n: number }).n;
  return Math.max(0, Math.min(...caps) - used);
}

function remainingBudget(sqlite: Database.Database, projectId: string, settings: RepairSettings, profileId: string | null, now: Date): RepairRemaining {
  const rows = rowsSince(sqlite, projectId);
  const attempts = new Set(rows.map((row) => row.attempt)).size;
  const renders = new Set(rows.filter((row) => row.render_used > 0).map((row) => row.attempt)).size;
  const spent = rows.reduce((sum, row) => sum + row.cost_usd, 0);
  return {
    attempts: Math.max(0, settings.maxAttemptsPerProject - attempts),
    renders: Math.min(Math.max(0, settings.maxRendersPerProject - renders), rendersLeftToday(sqlite, profileId, now)),
    usd: settings.maxUsdPerProject == null ? null : Math.max(0, settings.maxUsdPerProject - spent),
  };
}

// ---------------------------------------------------------------- choice

type Choice = { action: RepairActionKind; by: "agent" | "ladder"; costUsd: number; rejected?: string };

async function chooseRepair(
  env: RepairEnv,
  project: NonNullable<ReturnType<typeof projectRow>>,
  issues: RepairIssue[],
  allowed: RepairActionKind[][],
  tried: Record<string, string[]>,
  remaining: RepairRemaining,
  stats: RepairStatsByIssue,
): Promise<Array<Choice | null>> {
  const ladder = (index: number): Choice | null => {
    const action = nextLadderAction(issues[index]!.kind, allowed[index]!, (tried[issues[index]!.kind] ?? []) as RepairActionKind[], stats);
    return action ? { action, by: "ladder", costUsd: 0 } : null;
  };
  let eco = false;
  try {
    eco = (JSON.parse(project.settings) as { budget?: { mode?: string } }).budget?.mode === "ECO";
  } catch {
    eco = false;
  }
  const picks: Array<Choice | null> = issues.map((_, index) => ladder(index));
  if (eco || picks.every((pick) => pick === null)) return picks;
  let answer: RepairChoice | null = null;
  let costUsd = 0;
  try {
    if (env.chooser) {
      answer = await env.chooser({ issues, tried, remaining });
    } else if (env.ctx.registry) {
      const settings = getAppLlmSettings(env.ctx.sqlite);
      const projectObj = await env.ctx.projects.getProject(project.id);
      if (!projectObj) throw new Error("Không thấy dự án.");
      const route = env.ctx.registry.resolveTask("operatorRepair", projectObj, settings);
      const lines = issues.map((issue, index) => `${index}. ${issue.kind}: ${issue.detail}. Được chọn: ${allowed[index]!.join(", ")}. Đã thử: ${(tried[issue.kind] ?? []).join(", ") || "chưa"}.`);
      const worked = Object.entries(stats).flatMap(([kind, per]) => Object.entries(per ?? {})
        .filter(([, stat]) => stat && stat.tries >= 3 && stat.passed > 0)
        .map(([action, stat]) => `${kind}/${action}: ${stat!.passed}/${stat!.tries}`));
      const generated = await generateRoutedStructured({
        registry: env.ctx.registry,
        route,
        task: "operatorRepair",
        schema: RepairChoiceSchema,
        schemaName: "RepairChoice",
        schemaVersion: "1",
        system: "Bạn chọn một cách sửa cho mỗi lỗi chất lượng video. Chỉ chọn trong danh sách được chọn. Trả JSON.",
        prompt: `Lỗi:\n${lines.join("\n")}\nCòn lại: ${remaining.attempts} lượt, ${remaining.renders} lần render.\nTừng hiệu quả trên kênh này: ${worked.join("; ") || "chưa có số liệu"}.`,
        maxOutputTokens: 400,
        repairAttempts: 0,
        signal: env.ctx.signal ?? AbortSignal.timeout(30_000),
        cache: new LlmCache(env.ctx.sqlite, false),
      });
      answer = generated.value;
      costUsd = estimateLlmCost(env.ctx.config, generated.provider, generated.model, generated.usage);
    }
  } catch {
    answer = null;
  }
  if (!answer) return picks;
  const first = answer.choices.length ? answer.choices : [];
  let costGiven = false;
  return picks.map((fallback, index) => {
    const wanted = first.find((choice) => choice.issueIndex === index);
    if (!wanted) return fallback;
    if (!allowed[index]!.includes(wanted.action)) {
      return fallback ? { ...fallback, rejected: wanted.action } : null;
    }
    const cost = costGiven ? 0 : costUsd;
    costGiven = true;
    return { action: wanted.action, by: "agent", costUsd: cost };
  });
}

// ---------------------------------------------------------------- run one action

function toolFor(issue: RepairIssue, action: RepairActionKind, reason: string, projectId: string) {
  const ids = issue.sceneIds ?? [];
  if (["revise_script", "revise_script_stronger_model", "rerun_research_then_script", "new_angle"].includes(action)) {
    return { name: "repair_script", args: { projectId, action, reason } };
  }
  if (["vision_recheck", "pick_next_candidate", "research_scene", "web_search_scene", "rephrase_scene_visual", "switch_shot_type"].includes(action)) {
    return { name: "repair_scene", args: { projectId, sceneIds: ids, action, reason, ...(issue.gate === "RENDER" ? { thenTimeline: true } : {}) } };
  }
  return { name: "repair_render_stage", args: { projectId, action, reason } };
}

async function runRepair(env: RepairEnv, projectId: string, issue: RepairIssue, action: RepairActionKind, reason: string, extra: { targetWords?: number }) {
  const tool = toolFor(issue, action, reason, projectId);
  if (action === "revise_script_target_length" && extra.targetWords) (tool.args as Record<string, unknown>).targetWords = extra.targetWords;
  const result = await invokeRegistryTool({
    name: tool.name,
    args: tool.args,
    source: "operator",
    origin: "supervisor",
    ctx: env.ctx,
    actor: systemActorFor(
      env.ctx.sqlite,
      (env.ctx.sqlite.prepare("SELECT workspace_id AS w FROM projects WHERE id = ?").get(projectId) as { w: string | null } | undefined)?.w,
    ),
    createPending: () => { throw new Error("Cần người dùng duyệt."); },
  });
  if (result.kind !== "result") throw new Error(result.kind === "refused" ? result.message : "Công cụ sửa không chạy tự động.");
  return result.result;
}

// ---------------------------------------------------------------- the step

export async function repairStep(env: RepairEnv, projectId: string, gate: RepairGate): Promise<RepairStepResult> {
  const { sqlite } = env.ctx;
  const now = (env.now ?? (() => new Date()))();
  if (projectId === PROTECTED_PROJECT_ID) return { status: "off" };
  const project = projectRow(sqlite, projectId);
  if (!project) return { status: "off" };
  if (!effectiveAutonomy(sqlite, { projectId }).grants.retries) return { status: "off" };
  const settings = repairSettingsFor(sqlite, project.profileId);
  const visuals = env.visuals ?? (gate === "SCRIPT" ? undefined : await defaultVisuals(env.ctx));
  const issues = diagnose(sqlite, projectId, gate, visuals, { maxRevise: Math.max(2, settings.maxAttemptsPerProject) });
  const snapshot = gateSnapshot(sqlite, projectId, gate, issues);
  resolvePending(sqlite, projectId, gate, issues, snapshot);
  if (issues.length === 0) {
    writeScriptRepairHint(sqlite, projectId, null);
    return { status: "passed" };
  }
  const exhaust = (reason: string) => applyExhausted(env, project, gate, issues, settings, reason, now);
  const breaker = issues.find((issue) => breakerOpen(sqlite, project.profileId, issue.kind, now));
  if (breaker) return exhaust("breaker");
  if (project.profileId) {
    const budget = autonomyBudgetStatus(sqlite, env.ctx.usage, project.profileId, now);
    if (budget.state === "stop") return exhaust("ngân sách ngày hoặc tháng đã hết");
  }
  const remaining = remainingBudget(sqlite, projectId, settings, project.profileId, now);
  if (remaining.attempts <= 0) return exhaust("hết số lần sửa");
  if (remaining.usd !== null && remaining.usd <= 0) return exhaust("hết ngân sách sửa của dự án");
  const rows = rowsSince(sqlite, projectId);
  const tried: Record<string, string[]> = {};
  for (const row of rows) tried[row.issue_kind] = [...(tried[row.issue_kind] ?? []), row.action];
  const stats = repairStats(sqlite, project.profileId, 90, now).byIssue;
  // Every action at the render gate ends in a re-render, so the render budget gates all of them.
  const allowed = issues.map((issue) => issue.actions.filter((action) => (issue.gate !== "RENDER" && !RENDER_ACTIONS.has(action)) || remaining.renders > 0));
  const usable = issues.map((_, index) => index).filter((index) => allowed[index]!.length > 0);
  if (usable.length === 0) return exhaust("không còn cách sửa hoặc hết lượt render");
  const picks = await chooseRepair(env, project, issues, allowed, tried, remaining, stats);
  const attempt = (rows.reduce((max, row) => Math.max(max, row.attempt), 0)) + 1;
  const hash = snapshotHash(snapshot);
  const executed: Array<{ kind: RepairIssueKind; action: RepairActionKind; by: "agent" | "ladder" }> = [];
  let sync = true;
  let costLeft = remaining.usd;
  let loopStopped = false;
  for (const [index, issue] of issues.entries()) {
    const pick = picks[index];
    if (!pick) continue;
    // Loop guard: same action on the same issue with unchanged gate input.
    const repeated = rows.some((row) => row.issue_kind === issue.kind && row.action === pick.action
      && row.gate_before && snapshotHash(JSON.parse(row.gate_before) as unknown) === hash);
    if (repeated) { loopStopped = true; continue; }
    // Script and render fixes start jobs that depend on each other: one issue per round.
    if (gate !== "VISUALS" && executed.length > 0) continue;
    const renderUsed = issue.gate === "RENDER";
    if (gate !== "VISUALS") sync = false;
    const reason = `Tự sửa ${issue.kind}: ${issue.detail}`.slice(0, 200);
    const sceneIds = issue.sceneIds ?? [];
    let outcome = "pending";
    let failure: string | null = null;
    let undo: unknown = null;
    try {
      undo = await runRepair(env, projectId, issue, pick.action, reason, {
        targetWords: pick.action === "revise_script_target_length" ? targetWords(sqlite, projectId, settings) : undefined,
      });
    } catch (error) {
      outcome = "error";
      failure = error instanceof Error ? error.message : "lỗi";
    }
    const rowsToWrite = sceneIds.length ? sceneIds : [null];
    const cost = costLeft === null ? pick.costUsd : Math.min(pick.costUsd, costLeft);
    for (const [position, sceneId] of rowsToWrite.entries()) {
      sqlite.prepare(`INSERT INTO quality_repairs
        (id, project_id, profile_id, gate, issue_kind, scene_id, action, chosen_by, attempt, cost_usd, render_used, outcome, gate_before, gate_after, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).run(
        randomUUID(), projectId, project.profileId, gate, issue.kind, sceneId, pick.action, pick.by, attempt,
        position === 0 ? cost : 0, renderUsed ? 1 : 0, outcome,
        JSON.stringify({ ...snapshot, ...(pick.rejected ? { rejectedChoice: pick.rejected } : {}), ...(failure ? { error: failure } : {}) }),
        now.toISOString(),
      );
    }
    if (costLeft !== null) costLeft -= cost;
    logToolAudit(sqlite, {
      source: "operator", tool: "quality_repair", risk: "confirm", decision: outcome === "error" ? "refused" : "executed",
      args: { projectId, gate, issue: issue.kind, action: pick.action, sceneIds, by: pick.by },
      summary: `Tự sửa ${issue.kind} bằng ${pick.action}${failure ? `: ${failure}` : ""}`,
      origin: "supervisor", reason, undo, grant: "retries",
    });
    if (outcome !== "error") executed.push({ kind: issue.kind, action: pick.action, by: pick.by });
  }
  if (executed.length === 0) return exhaust(loopStopped ? "lặp lại cách sửa mà không đổi kết quả" : "không chạy được cách sửa nào");
  return { status: "repairing", attempt, maxAttempts: settings.maxAttemptsPerProject, actions: executed, sync };
}

function targetWords(sqlite: Database.Database, projectId: string, _settings: RepairSettings): number | undefined {
  const row = projectRow(sqlite, projectId);
  try {
    const parsed = JSON.parse(row?.settings ?? "{}") as { targetDurationSec?: number; wordsPerMinute?: number };
    if (!parsed.targetDurationSec) return undefined;
    return Math.round((parsed.targetDurationSec / 60) * (parsed.wordsPerMinute ?? 150));
  } catch {
    return undefined;
  }
}

async function defaultVisuals(ctx: AssistantToolContext): Promise<RepairVisuals> {
  const { VisualService } = await import("../services/visualService.js");
  const { JobRepository } = await import("../jobs/jobRepository.js");
  const { PipelineEventBus } = await import("../jobs/eventBus.js");
  return new VisualService(ctx.sqlite, new JobRepository(ctx.sqlite, new PipelineEventBus()), ctx.config);
}

/** Runs rounds until one has to wait for a job, passes, or runs out. Scene fixes are instant, so they loop. */
export async function runQualityRepair(env: RepairEnv, projectId: string, gate: RepairGate): Promise<RepairStepResult> {
  let result = await repairStep(env, projectId, gate);
  for (let round = 0; round < MAX_SYNC_ROUNDS && result.status === "repairing" && result.sync; round += 1) {
    result = await repairStep(env, projectId, gate);
  }
  return result;
}

// ---------------------------------------------------------------- exhausted: shelve or ask

function triedText(sqlite: Database.Database, projectId: string): string {
  const rows = rowsSince(sqlite, projectId);
  if (!rows.length) return "chưa thử cách nào";
  const seen = new Set<string>();
  for (const row of rows) seen.add(`${row.issue_kind}: ${row.action}`);
  return [...seen].join("; ");
}

function applyExhausted(
  env: RepairEnv,
  project: NonNullable<ReturnType<typeof projectRow>>,
  gate: RepairGate,
  issues: RepairIssue[],
  settings: RepairSettings,
  reason: string,
  now: Date,
): RepairStepResult {
  const { sqlite } = env.ctx;
  const attempts = new Set(rowsSince(sqlite, project.id).map((row) => row.attempt)).size;
  const summary = issues.map((issue) => issue.detail).join(", ");
  const kinds = [...new Set(issues.map((issue) => issue.kind))];
  if (settings.onExhausted === "ask") {
    const why = `Tự sửa chưa đạt (${reason}): ${summary}. Đã thử: ${triedText(sqlite, project.id)}.`;
    recordHeld(sqlite, project.id, why);
    const titles: Record<RepairGate, [string, string]> = {
      SCRIPT: ["Giữ cổng kịch bản", "script-gate"], VISUALS: ["Giữ cổng ảnh cảnh", "visual-gate"], RENDER: ["Giữ cổng render", "render-gate"],
    };
    try {
      createUserRequest(sqlite, {
        profileId: project.profileId, kind: "approve", title: titles[gate][0], whyVi: why.slice(0, 500),
        actionUrl: `/projects/${project.id}/overview`, dedupeKey: `${titles[gate][1]}:${project.id}`, checkKind: "approve",
      });
    } catch {
      // The daily question cap may be used up; the held gate is still recorded.
    }
    return { status: "exhausted", reason, handled: "asked" };
  }
  const line = `Đã gác video «${project.title}»: ${summary} sau ${attempts} lần sửa.`;
  shelveProject(sqlite, project, line, kinds, now);
  const opened = noteShelvedAndMaybeOpenBreaker(sqlite, project.profileId, kinds, now);
  return { status: "exhausted", reason, handled: opened ? "breaker" : "shelved" };
}

/** Status SHELVED, schedule slot freed, topic re-queued once (or dropped if it was shelved before). */
export function shelveProject(
  sqlite: Database.Database,
  project: { id: string; title: string; profileId: string | null; status: string },
  line: string,
  kinds: string[],
  now: Date,
): void {
  const at = now.toISOString();
  sqlite.prepare("UPDATE projects SET status = 'SHELVED', updated_at = ? WHERE id = ?").run(at, project.id);
  sqlite.prepare(`UPDATE publications SET status = 'CANCELLED', guardrail_reason = 'shelved', updated_at = ?
    WHERE project_id = ? AND status IN ('SCHEDULED', 'PENDING', 'QUEUED')`).run(at, project.id);
  const topic = sqlite.prepare("SELECT id, notes FROM profile_topics WHERE project_id = ?").get(project.id) as { id: string; notes: string | null } | undefined;
  if (topic) {
    const already = (topic.notes ?? "").includes("[repair]");
    if (already) {
      sqlite.prepare("UPDATE profile_topics SET status = 'REJECTED', error = ?, updated_at = ? WHERE id = ?")
        .run("Đã gác hai lần, bỏ khỏi hàng chờ.", at, topic.id);
    } else {
      sqlite.prepare(`UPDATE profile_topics SET status = 'APPROVED', project_id = NULL, scheduled_for = NULL, priority = 0, notes = ?, updated_at = ?
        WHERE id = ?`).run(`${topic.notes ?? ""} [repair] ${kinds.join(", ")}`.trim(), at, topic.id);
    }
  }
  sqlite.prepare(`INSERT INTO supervisor_findings
    (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
    VALUES (?, ?, 'quality_shelved', 'info', ?, ?, ?, ?, 'open')
    ON CONFLICT(dedupe_key) DO UPDATE SET detail = excluded.detail, last_seen_at = excluded.last_seen_at`).run(
    randomUUID(), project.profileId, `quality_shelved:${project.id}:${at}`,
    JSON.stringify({ projectId: project.id, title: project.title, kinds, line, previousStatus: project.status }), at, at,
  );
}

function breakerKey(profileId: string, kind: string): string {
  return `repair.breaker.${profileId}.${kind}`;
}

function breakerOpen(sqlite: Database.Database, profileId: string | null, kind: string, now: Date): boolean {
  if (!profileId) return false;
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(breakerKey(profileId, kind)) as { value: string } | undefined;
  return Boolean(row && row.value > now.toISOString());
}

/** 3 shelved projects in a row on a profile with the same issue kind open the breaker for that kind. */
function noteShelvedAndMaybeOpenBreaker(sqlite: Database.Database, profileId: string | null, kinds: string[], now: Date): boolean {
  if (!profileId) return false;
  const last = sqlite.prepare(`SELECT detail, first_seen_at AS at FROM supervisor_findings
    WHERE kind = 'quality_shelved' AND profile_id = ? ORDER BY first_seen_at DESC, rowid DESC LIMIT 3`).all(profileId) as Array<{ detail: string; at: string }>;
  if (last.length < 3) return false;
  const lists = last.map((row) => (JSON.parse(row.detail) as { kinds: string[] }).kinds);
  const common = kinds.find((kind) => lists.every((list) => list.includes(kind)));
  if (!common) return false;
  const passed = sqlite.prepare("SELECT COUNT(*) AS n FROM quality_repairs WHERE profile_id = ? AND outcome = 'passed' AND created_at > ?")
    .get(profileId, last[2]!.at) as { n: number };
  if (passed.n > 0) return false;
  const retryAt = new Date(now.getTime() + BREAKER_MS).toISOString();
  const at = now.toISOString();
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(breakerKey(profileId, common), retryAt, at);
  sqlite.prepare(`INSERT INTO supervisor_findings
    (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
    VALUES (?, ?, 'breaker_open', 'warn', ?, ?, ?, ?, 'open')
    ON CONFLICT(dedupe_key) DO UPDATE SET detail = excluded.detail, last_seen_at = excluded.last_seen_at, status = 'open', resolution = NULL`)
    .run(randomUUID(), profileId, `breaker_open:${profileId}:repair-${common}`, JSON.stringify({ stage: `repair:${common}`, retryAt, delayMs: BREAKER_MS }), at, at);
  return true;
}

// ---------------------------------------------------------------- reopen + digest

/** The user reopens a shelved project from the project page. Counters restart. */
export function reopenShelved(sqlite: Database.Database, projectId: string, now = new Date()): { status: string } {
  const project = projectRow(sqlite, projectId);
  if (!project || project.status !== "SHELVED") return { status: project?.status ?? "missing" };
  const at = now.toISOString();
  const finding = sqlite.prepare(`SELECT detail FROM supervisor_findings WHERE kind = 'quality_shelved' AND dedupe_key LIKE ?
    ORDER BY first_seen_at DESC LIMIT 1`).get(`quality_shelved:${projectId}:%`) as { detail: string } | undefined;
  let previous = "REVIEW";
  try {
    previous = (JSON.parse(finding?.detail ?? "{}") as { previousStatus?: string }).previousStatus ?? "REVIEW";
  } catch {
    previous = "REVIEW";
  }
  if (previous === "SHELVED") previous = "REVIEW";
  sqlite.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(previous, at, projectId);
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(`repair.reset.${projectId}`, at, at);
  sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(`repair.hint.${projectId}`);
  return { status: previous };
}

/** Projects the loop is working on right now, for the dashboard. */
export function activeRepairs(sqlite: Database.Database) {
  const rows = sqlite.prepare(`SELECT q.project_id AS projectId, p.title AS title, p.profile_id AS profileId,
      COUNT(DISTINCT q.attempt) AS attempts
    FROM quality_repairs q JOIN projects p ON p.id = q.project_id
    WHERE q.outcome = 'pending' AND p.status != 'SHELVED' AND p.archived_at IS NULL
      AND q.created_at > COALESCE((SELECT value FROM app_settings WHERE key = 'repair.reset.' || q.project_id), '')
    GROUP BY q.project_id`).all() as Array<{ projectId: string; title: string; profileId: string | null; attempts: number }>;
  return rows.map((row) => ({ ...row, maxAttempts: repairSettingsFor(sqlite, row.profileId).maxAttemptsPerProject }));
}

/** Stage summary suffix: "· Tự sửa: N lần, M cảnh đổi ảnh". Empty when no repair ran. */
export function repairSummarySuffix(sqlite: Database.Database, projectId: string): string {
  const log = listRepairLog(sqlite, projectId);
  if (log.attempts === 0) return "";
  const images = new Set(log.rows.filter((row) => row.sceneId && row.outcome !== "error"
    && ["pick_next_candidate", "research_scene", "web_search_scene", "rephrase_scene_visual"].includes(row.action)).map((row) => row.sceneId)).size;
  return ` · Tự sửa: ${log.attempts} lần${images ? `, ${images} cảnh đổi ảnh` : ""}`;
}
