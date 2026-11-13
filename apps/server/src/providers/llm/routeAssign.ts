import {
  LLM_TASKS,
  omnirouteModelSeesImages,
  LlmSettingsSchema,
  VISION_ROUTE_TASKS,
  type LlmModelRef,
  type LlmRoute,
  type LlmRouteAssignBody,
  type LlmRouteAssignResult,
  type LlmSettings,
  type LlmTaskId,
} from "@vg/shared";
import type { ProjectService } from "../../services/projectService.js";
import { AppError } from "../../lib/errors.js";
import type { LlmProviderRegistry } from "./registry.js";
import { getAppLlmSettings, getLlmVisionMarks, saveAppLlmSettings, saveLlmVisionMarks } from "./settings.js";
import type Database from "better-sqlite3";

const BUILTIN_VISION = new Set(["anthropic", "gemini", "claude-cli", "copilot-cli", "mock"]);

function taskNeedsVision(task: LlmTaskId): boolean {
  return LLM_TASKS.some((entry) => entry.id === task && entry.needsVision === true);
}

function seesImages(registry: LlmProviderRegistry, provider: string, model: string): boolean {
  if (BUILTIN_VISION.has(provider)) return true;
  if (provider === "omniroute" && omnirouteModelSeesImages(model)) return true;
  if (provider === "omniroute") {
    const row = registry.omnirouteCatalog.peekModels().find((item) => item.id === model);
    if (row?.vision === true) return true;
    if (row?.vision === false) return false;
  }
  return registry.get(provider)?.capabilities?.vision === true;
}

function remember(marks: LlmModelRef[], next: LlmModelRef): LlmModelRef[] {
  const key = `${next.provider}\n${next.model}`;
  const kept = marks.filter((row) => `${row.provider}\n${row.model}` !== key);
  return [...kept, next].slice(-40);
}

function applyAssignments(
  current: LlmSettings | undefined,
  assignments: LlmRouteAssignBody["assignments"],
): { settings: LlmSettings; routes: LlmRoute[] } {
  const tasks = { ...(current?.tasks ?? {}) };
  let nextDefault = current?.default;
  const routes: LlmRoute[] = [];
  for (const assignment of assignments) {
    const route: LlmRoute = { provider: assignment.provider, model: assignment.model };
    routes.push(route);
    if (assignment.task === "default") {
      nextDefault = route;
      continue;
    }
    const taskIds: LlmTaskId[] = assignment.task === "vision" ? VISION_ROUTE_TASKS : [assignment.task];
    for (const taskId of taskIds) tasks[taskId] = route;
  }
  const settings = LlmSettingsSchema.parse({
    ...(nextDefault ? { default: nextDefault } : {}),
    ...(Object.keys(tasks).length ? { tasks } : {}),
  });
  return { settings, routes };
}

export async function assignLlmRoutes(input: {
  sqlite: Database.Database;
  registry: LlmProviderRegistry;
  projects?: ProjectService;
  body: LlmRouteAssignBody;
}): Promise<LlmRouteAssignResult> {
  for (const assignment of input.body.assignments) {
    if (!input.registry.isSupportedProvider(assignment.provider)) {
      throw new AppError(400, "INVALID_LLM_PROVIDER", "Một route trỏ tới nhà cung cấp không hỗ trợ.");
    }
  }

  const currentApp = getAppLlmSettings(input.sqlite) ?? {};
  let stored: LlmSettings;
  if (input.body.scope === "project") {
    const projectId = input.body.projectId;
    if (!projectId || !input.projects) {
      throw new AppError(503, "PROJECTS_UNAVAILABLE", "Chưa gán được route cho dự án.");
    }
    const project = await input.projects.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án.");
    const { settings } = applyAssignments(project.settings.llm, input.body.assignments);
    const updated = await input.projects.updateProject(projectId, { settings: { llm: settings } });
    if (!updated) throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án.");
    stored = updated.settings.llm ?? settings;
  } else {
    const { settings } = applyAssignments(currentApp, input.body.assignments);
    saveAppLlmSettings(input.sqlite, settings);
    stored = settings;
  }

  let marks = getLlmVisionMarks(input.sqlite).models;
  const markedNow: LlmModelRef[] = [];
  for (const assignment of input.body.assignments) {
    const visionTask = assignment.task === "vision" || (assignment.task !== "default" && taskNeedsVision(assignment.task));
    if (!visionTask || seesImages(input.registry, assignment.provider, assignment.model)) continue;
    const ref = { provider: assignment.provider, model: assignment.model };
    marks = remember(marks, ref);
    if (!markedNow.some((row) => row.provider === ref.provider && row.model === ref.model)) markedNow.push(ref);
  }
  const visionModels = saveLlmVisionMarks(input.sqlite, { models: marks }).models;

  return {
    scope: input.body.scope,
    ...(input.body.projectId ? { projectId: input.body.projectId } : {}),
    ...(stored.default ? { default: stored.default } : {}),
    tasks: stored.tasks ?? {},
    visionModels,
    markedNow,
  };
}
