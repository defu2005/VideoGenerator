import type Database from "better-sqlite3";
import { dependentStages, GATES, LLM_TASKS, PROTECTED_PROJECT_ID, STAGE_ORDER, resolveBudget, resolveStageExecution, storyModeForProject, type PipelineStage, type Project, type ProjectRun } from "@vg/shared";
import { defaultWorkspaceId } from "../auth/workspaces.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { readAppVersion } from "../render/appVersion.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { NODE_OFFLINE_AFTER_MS, type NodeService } from "./nodeService.js";
import type { ProjectRunService } from "./runService.js";
import { getRemoteRenderSettings } from "./settings.js";
import { planProjectSegment, type SegmentPlanInput } from "./segmentPlanner.js";
import type { RunCommands } from "./runCommands.js";

const CLI_PROVIDER_IDS: ReadonlySet<string> = new Set(["claude-cli", "copilot-cli", "antigravity-cli"]);

export function resolveProjectStageNeeds(db: Database.Database, llm: LlmProviderRegistry, project: Project, voiceProvider: string) {
  const needs: Partial<Record<PipelineStage, string[]>> = {
    VOICE: [`tts:${voiceProvider}`, "ffmpeg"], SUBTITLE: ["ffmpeg"],
    VISUAL_SEARCH: ["search:wikimedia", "ffmpeg"], RENDER: ["render", "ffmpeg"],
  };
  const budget = resolveBudget(project);
  const routing = getAppLlmSettings(db);
  for (const task of LLM_TASKS) {
    const stage = STAGE_ORDER.find((candidate) => candidate === task.stage);
    if (!stage || GATES.includes(stage) || (stage === "RESEARCH" && storyModeForProject(project) === "off")) continue;
    if (task.budgetFeature) {
      const setting = budget[task.budgetFeature];
      if (!setting || setting === "off") continue;
    }
    try {
      const route = llm.resolveTask(task.id, project, routing);
      // TASK-136: API providers run through the server's relay on any machine; CLI logins stay on the control machine.
      (needs[stage] ??= []).push(CLI_PROVIDER_IDS.has(route.provider.id) ? `llm:${route.provider.id}` : "llm:relay");
    } catch {
      if (task.id === "research" || task.id === "script") (needs[stage] ??= []).push("llm:unconfigured");
    }
  }
  return needs;
}

export class ProjectPlacement {
  private readonly observedInput = new Map<string, string>();

  constructor(private readonly deps: {
    db: Database.Database;
    orchestrator: PipelineOrchestrator;
    runs: ProjectRunService;
    nodes: NodeService;
    needs(project: Project): SegmentPlanInput["stageNeeds"];
    budget(project: Project, at: Date): number;
    eligible?: () => boolean;
    canLend?: (scope: string) => boolean;
    commands?: RunCommands;
    now?: () => Date;
  }) {}

  active = (projectId: string) => this.deps.runs.activeForProject(projectId)?.fromStage;
  cancel = (projectId: string) => this.deps.runs.cancel(projectId, "USER_CANCELLED") > 0;

  noteAccepted(run: ProjectRun): void {
    this.observedInput.set(run.id, this.deps.runs.baseVersion(run.projectId));
  }

  dispatch = (project: Project, ready: readonly PipelineStage[]): boolean => {
    const { db, orchestrator, runs, nodes } = this.deps;
    if (this.active(project.id)) return true;
    if (project.id === PROTECTED_PROJECT_ID || this.deps.eligible?.() === false) return false;
    const row = db.prepare("SELECT execution_mode,execution_node,workspace_id FROM projects WHERE id=?").get(project.id) as
      { execution_mode: string; execution_node: string | null; workspace_id: string | null } | undefined;
    if (row?.execution_mode !== "node" || orchestrator.repository.getActiveJobs(project.id).length) return false;
    const at = this.deps.now?.() ?? new Date();
    const states = Object.fromEntries(orchestrator.repository.getStages(project.id).map(({ stage, state }) => [stage, state]));
    const profileRow = project.profileId ? db.prepare("SELECT default_brief FROM profiles WHERE id=?").get(project.profileId) as { default_brief: string } | undefined : undefined;
    let profile: Parameters<typeof resolveStageExecution>[2];
    try { profile = profileRow ? JSON.parse(profileRow.default_brief) ?? undefined : undefined; }
    catch { profile = undefined; }
    const manual = new Map<PipelineStage, "USER">();
    if (project.settings.stageExecutors.script === "USER") { manual.set("RESEARCH", "USER"); manual.set("SCRIPT", "USER"); }
    if (project.settings.stageExecutors.voice === "USER") manual.set("VOICE", "USER");
    if (project.settings.stageExecutors.visuals === "USER") manual.set("VISUAL_SEARCH", "USER");
    if (project.settings.stageExecutors.music === "USER") manual.set("MUSIC_SEARCH", "USER");
    const executors = Object.fromEntries(STAGE_ORDER.map((stage) => {
      const mode = manual.get(stage) ?? resolveStageExecution(stage, project.settings, profile);
      // Control hosts agent fallback so the existing handoff and approval rules still run.
      return [stage, mode === "app_then_agent" ? "agent" : mode];
    }));
    const automaticGates = new Set<PipelineStage>(project.mode === "AUTO" ? GATES.filter((gate) => gate !== "FINAL_APPROVAL" || project.settings.autoRender) : []);
    const stageNeeds = this.deps.needs(project);
    const ideal = planProjectSegment({ states, executors, automaticGates, stageNeeds, capabilities: new Set(["project", ...Object.values(stageNeeds).flat()]) });
    if (!ideal.fromStage || ready.some((stage) => ideal.stopBefore.includes(stage))) {
      this.clearWait(project.id);
      return false;
    }
    const workspace = row.workspace_id ?? defaultWorkspaceId(db);
    if (!workspace) return false;
    const last = db.prepare("SELECT node_id,status,end_reason FROM project_runs WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(project.id) as
      { node_id: string; status: string; end_reason: string | null } | undefined;
    if (ready.some((stage) => last?.end_reason === `BOUNDARY:${stage}`)) {
      this.clearWait(project.id);
      return false;
    }
    const candidates = nodes.list().flatMap((node) => {
      if (row.execution_node && row.execution_node !== node.id) return [];
      if (node.status !== "online" || node.revokedAt || node.desiredConfig.drain || node.version !== readAppVersion()) return [];
      if (!node.lastSeenAt || at.getTime() - Date.parse(node.lastSeenAt) > NODE_OFFLINE_AFTER_MS) return [];
      if (node.runningJobs >= node.desiredConfig.concurrency || (last?.status === "LOST" && last.node_id === node.id)) return [];
      const stored = nodes.get(node.id);
      if (stored?.workspace_id && stored.workspace_id !== workspace) return [];
      const caps = new Set(node.capabilities.filter((capability) => node.desiredConfig.capabilities.includes(capability)));
      for (const capability of caps) {
        if (!capability.startsWith("borrow:")) continue;
        const scope = capability.slice(7);
        if (this.deps.canLend?.(scope)) caps.add(scope);
      }
      if (node.probe?.render.ok === false) caps.delete("render");
      if (db.prepare("SELECT 1 FROM project_runs WHERE node_id=? AND status IN ('GRANTED','RUNNING') AND lease_until>?").get(node.id, at.toISOString())) return [];
      const plan = planProjectSegment({ states, executors, automaticGates, stageNeeds, capabilities: caps });
      return plan.fromStage && ready.includes(plan.fromStage) ? [{ node, plan }] : [];
    }).sort((a, b) => b.plan.stages.length - a.plan.stages.length
      || Number(b.node.id === last?.node_id) - Number(a.node.id === last?.node_id)
      || (b.node.desiredConfig.concurrency - b.node.runningJobs) - (a.node.desiredConfig.concurrency - a.node.runningJobs)
      || (b.node.resources?.cpus ?? 0) - (a.node.resources?.cpus ?? 0) || a.node.id.localeCompare(b.node.id));
    const selected = candidates[0];
    if (selected?.plan.fromStage) {
      runs.grant(selected.node, { projectId: project.id, fromStage: selected.plan.fromStage, stopBefore: selected.plan.stopBefore, budgetCapUsd: this.deps.budget(project, at) });
      this.clearWait(project.id);
      return true;
    }
    const fallback = (db.prepare("SELECT value FROM app_settings WHERE key IN (?, 'execution.fallback') ORDER BY key DESC LIMIT 1")
      .get(`execution.fallback.${project.id}`) as { value: string } | undefined)?.value;
    if (fallback === '"wait"') return true;
    if (last?.status === "LOST") { this.clearWait(project.id); return false; }
    const key = this.waitKey(project.id);
    db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES (?,?,?)").run(key, "null", at.toISOString());
    const first = db.prepare("SELECT updated_at FROM app_settings WHERE key=?").get(key) as { updated_at: string };
    if (at.getTime() - Date.parse(first.updated_at) < getRemoteRenderSettings(db).remoteWaitSec * 1000) return true;
    return false;
  };

  private waitKey(projectId: string) { return `execution.wait.${projectId}`; }

  private clearWait(projectId: string) {
    this.deps.db.prepare("DELETE FROM app_settings WHERE key=?").run(this.waitKey(projectId));
  }

  private synchronize(run: ProjectRun): void {
    const { commands, db, orchestrator, runs } = this.deps;
    if (!commands) return;
    const project = orchestrator.repository.getProject(run.projectId);
    if (!project) return;
    const held = new Set(run.stopBefore);
    for (const gate of GATES) {
      if ([...held].some((stage) => stage === gate || dependentStages(stage).includes(gate))) continue;
      if (project.mode !== "AUTO" || (gate === "FINAL_APPROVAL" && !project.settings.autoRender)) {
        const state = orchestrator.repository.getStage(project.id, gate).state;
        if (state !== "DONE" && state !== "SKIPPED") held.add(gate);
      }
    }
    const version = runs.baseVersion(run.projectId);
    if (held.size !== run.stopBefore.length) {
      commands.enqueue(run.id, { kind: "stopBefore", stages: [...held] });
      this.observedInput.set(run.id, version);
    } else {
      if (version !== (this.observedInput.get(run.id) ?? run.baseVersion)) {
        commands.enqueue(run.id, { kind: "rebase" });
        this.observedInput.set(run.id, version);
      }
    }
    const { total } = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM cost_entries WHERE source=? AND currency='USD'")
      .get(`run:${run.id}`) as { total: number };
    const cap = Math.min(Number.MAX_SAFE_INTEGER, total + this.deps.budget(project, this.deps.now?.() ?? new Date()));
    if (Math.abs(cap - run.budgetCapUsd) > 0.000001) commands.enqueue(run.id, { kind: "budget", capUsd: cap });
  }

  sweep(onError: (error: unknown) => void): void {
    const { db, runs, orchestrator } = this.deps;
    runs.expire();
    const activeRuns = new Set<string>();
    for (const { id } of db.prepare("SELECT id FROM projects WHERE execution_mode='node' AND run_mode='ALL' AND archived_at IS NULL").all() as Array<{ id: string }>) {
      try {
        const run = runs.activeForProject(id);
        if (run) {
          activeRuns.add(run.id);
          this.synchronize(run);
        } else if (!orchestrator.repository.getActiveJobs(id).length) {
          orchestrator.resumePlacedProject(id);
        }
      } catch (error) { onError(error); }
    }
    for (const id of this.observedInput.keys()) if (!activeRuns.has(id)) this.observedInput.delete(id);
  }
}
