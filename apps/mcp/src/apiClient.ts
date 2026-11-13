import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  CreateProjectInput,
  CreateProjectResponse,
  ProjectListResponse,
  Project,
  ProfileListResponse,
  RecommendBriefResponse,
  ResearchNotes,
  Script,
  ScenePlanSummary,
  ProjectVisuals,
  SceneVisuals,
  LlmRoute,
  LlmTaskId,
  ProjectUsage,
  GuidelinePack,
} from "@vg/shared";

const SERVER_DOWN_GUIDANCE = "Start it with `npm run dev`.";

function workspaceRoot(start: string): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, "package.json"))) {
      try {
        const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { workspaces?: unknown };
        if (manifest.workspaces !== undefined) return directory;
      } catch {
        // Keep walking if this package.json is not the workspace root.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return resolve(start);
    directory = parent;
  }
}

function resolveDataDir(): string {
  const root = workspaceRoot(process.cwd());
  const configured = process.env.DATA_DIR?.trim();
  if (!configured) return join(root, "data");
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

function localServiceApiKey(): string | undefined {
  const fromEnv = process.env.VG_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const path = join(resolveDataDir(), "secrets", "local-services.key");
  try {
    const key = readFileSync(path, "utf8").trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export class VideoAgentApiError extends Error {
  constructor(
    message: string,
    readonly rawBody?: string,
  ) {
    super(message);
    this.name = "VideoAgentApiError";
  }
}

export class VideoAgentApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl = process.env.VG_API_URL ?? "http://127.0.0.1:3001",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  listProjects(query: { q?: string; status?: string } = {}): Promise<ProjectListResponse> {
    const params = new URLSearchParams({ pageSize: "20" });
    if (query.q) params.set("q", query.q);
    if (query.status) params.set("status", query.status);
    return this.request(`/api/projects?${params.toString()}`);
  }

  listProfiles(query: { includeArchived?: boolean } = {}): Promise<ProfileListResponse> {
    const params = new URLSearchParams();
    if (query.includeArchived) params.set("includeArchived", "true");
    const qs = params.toString();
    return this.request(`/api/profiles${qs ? `?${qs}` : ""}`);
  }

  getGuidelinePacks(): Promise<{ builtIn: GuidelinePack[]; custom: GuidelinePack[]; disclaimer: string }> {
    return this.request("/api/guidelines/packs");
  }

  getProject(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}`);
  }

  getComposePlan(projectId: string): Promise<unknown> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/compose-plan`);
  }

  getProjectUsage(projectId: string): Promise<ProjectUsage> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/usage`);
  }

  createProject(input: CreateProjectInput): Promise<CreateProjectResponse> {
    return this.request("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  recommendBrief(input: CreateProjectInput): Promise<RecommendBriefResponse> {
    return this.request("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getScript(projectId: string): Promise<{
    script: { data: Script; origin: "AGENT" | "USER"; edited: boolean; version: number } | null;
    research: { data: ResearchNotes; provider: string; model: string; cached: boolean } | null;
    origin: "AGENT" | "USER" | null;
    version: number;
    stale: boolean;
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/script`);
  }

  getScenes(projectId: string): Promise<ScenePlanSummary> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/scenes`);
  }

  getProjectVisuals(projectId: string): Promise<ProjectVisuals> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/visuals`);
  }

  getSceneVisuals(projectId: string, sceneId: string): Promise<SceneVisuals> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/visuals`);
  }

  approveSceneVisual(projectId: string, sceneId: string): Promise<SceneVisuals> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/visuals/approve`, {
      method: "POST",
    });
  }

  selectSceneVisual(projectId: string, sceneId: string, candidateId: string): Promise<SceneVisuals> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/visuals/select`, {
      method: "POST",
      body: JSON.stringify({ candidateId }),
    });
  }

  getLlmQuotaStatus(): Promise<unknown> {
    return this.request("/api/llm/quota");
  }

  getLlmHealth(): Promise<unknown> {
    return this.request("/api/llm/health");
  }

  getVisionMarks(): Promise<{ models: Array<{ provider: string; model: string }> }> {
    return this.request("/api/settings/llm-vision-models");
  }

  getAppLlmRouting(): Promise<unknown> {
    return this.request("/api/settings/llm-routing");
  }

  recomputeStageTimeouts(projectId: string): Promise<unknown> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/stage-timeouts/recompute`, { method: "POST" });
  }

  setStageTimeout(projectId: string, stage: string, timeoutSec: number | null): Promise<unknown> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/stage-timeouts`, {
      method: "PATCH",
      body: JSON.stringify({ stage, timeoutSec }),
    });
  }

  retryStage(projectId: string, stage: string): Promise<unknown> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/pipeline/stages/${encodeURIComponent(stage)}/retry`, {
      method: "POST",
    });
  }

  assignLlmRoutes(body: {
    scope?: "app" | "project";
    projectId?: string;
    assignments: Array<{ task: string; provider: string; model: string }>;
  }): Promise<unknown> {
    return this.request("/api/settings/llm-routing/assign", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getLlmRoutes(projectId: string): Promise<{
    routes: Partial<Record<LlmTaskId, (LlmRoute & {
      model: string;
      source: "project-task" | "project-default" | "app-task" | "app-default" | "env-task" | "env-default";
    }) | null>>;
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/llm-routes`);
  }

  getPrompt(projectId: string, stage: "RESEARCH" | "SCRIPT" | "STORY"): Promise<{
    stage: string;
    system: string;
    user: string;
    jsonSchema: Record<string, unknown>;
    language: string;
    targetDurationSec: number;
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/prompts/${stage}`);
  }

  saveResearch(projectId: string, research: unknown): Promise<unknown> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/research`, {
      method: "PUT",
      body: JSON.stringify(research),
    });
  }

  saveScript(projectId: string, script: unknown): Promise<unknown> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/script`, {
      method: "PUT",
      body: JSON.stringify(script),
    });
  }

  getPipeline(projectId: string): Promise<{
    projectId: string;
    currentStage: string;
    status: string;
    runMode: string | null;
    activeJob: unknown;
    stages: { stage: string; state: string; progress: number; message: string | null }[];
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/pipeline`);
  }

  getVideoMetadata(projectId: string): Promise<{
    metadata: {
      projectId: string;
      inputHash: string;
      draft: unknown;
      edited: unknown;
      source: "LLM" | "CODE";
      createdAt: string;
      updatedAt: string;
    } | null;
    stale: boolean;
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/metadata`);
  }

  getAutoReport(projectId: string): Promise<{
    projectId: string;
    warnCount: number;
    groups: { stage: string; entries: unknown[] }[];
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/auto-report`);
  }

  listRenders(projectId: string): Promise<{ renders: unknown[] }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/renders`);
  }

  getRenderExportUrl(projectId: string, renderId: string): { url: string } {
    return {
      url: `${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/renders/${encodeURIComponent(renderId)}/export`,
    };
  }

  getReviewContext(projectId: string): Promise<{
    contextHash: string;
    document: unknown;
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/review/context`);
  }

  applyReviewProposal(projectId: string, proposal: unknown): Promise<{
    result: unknown;
    staleStages: string[];
  }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/review/apply`, {
      method: "POST",
      body: JSON.stringify({ proposal }),
    });
  }

  runPipeline(projectId: string, stage?: string): Promise<unknown> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/pipeline/run`, {
      method: "POST",
      body: JSON.stringify(stage ? { stage } : {}),
    });
  }

  publishProject(
    projectId: string,
    input: { accountIds: string[]; scheduledFor?: string; visibility?: string; force?: boolean },
  ): Promise<{ items: unknown[] }> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/publications`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listPublications(query: { status?: string; profileId?: string } = {}): Promise<{ items: unknown[] }> {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.profileId) params.set("profileId", query.profileId);
    const qs = params.toString();
    return this.request(`/api/publications${qs ? `?${qs}` : ""}`);
  }

  listTopics(profileId: string, status?: string): Promise<{ items: unknown[] }> {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    const qs = params.toString();
    return this.request(`/api/profiles/${encodeURIComponent(profileId)}/topics${qs ? `?${qs}` : ""}`);
  }

  addTopic(profileId: string, input: { topic: string; notes?: string | null; priority?: number; status?: string }): Promise<unknown> {
    return this.request(`/api/profiles/${encodeURIComponent(profileId)}/topics`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  suggestTopics(profileId: string, input: { hint?: string; count?: number }): Promise<unknown> {
    return this.request(`/api/profiles/${encodeURIComponent(profileId)}/topics/suggest`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  approveTopics(profileId: string, input: { ids: string[]; status: "APPROVED" | "REJECTED" }): Promise<unknown> {
    return this.request(`/api/profiles/${encodeURIComponent(profileId)}/topics/approve`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  automationStatus(): Promise<unknown> {
    return this.request("/api/automation/status");
  }

  listRegistryTools(): Promise<{ tools: Array<{ name: string; description: string; risk: string; properties?: Record<string, unknown>; inputSchema?: Record<string, unknown> }> }> {
    return this.request("/api/registry/tools");
  }

  invokeRegistry(name: string, args: unknown): Promise<{
    result?: unknown;
    pendingActionId?: string;
    summaryVi?: string;
  }> {
    const headers: Record<string, string> = {};
    if (process.env.VG_TOOL_SOURCE === "operator" || process.env.VG_TOOL_SOURCE === "agent") {
      headers["x-vg-tool-source"] = process.env.VG_TOOL_SOURCE;
    }
    for (const [envName, header] of [
      ["VG_AGENT_KIND", "x-vg-agent-kind"],
      ["VG_AGENT_NAME", "x-vg-agent-name"],
      ["VG_AGENT_MODEL", "x-vg-agent-model"],
      ["VG_ENVIRONMENT", "x-vg-environment"],
    ] as const) {
      const value = process.env[envName];
      if (value) headers[header] = value;
    }
    if (process.env.VG_TOOL_SOURCE === "operator" && process.env.VG_OPERATOR_MANAGED === "1") {
      headers["x-vg-operator-managed"] = "1";
      if (process.env.VG_OPERATOR_INVOCATION) headers["x-vg-operator-invocation"] = process.env.VG_OPERATOR_INVOCATION;
    }
    return this.request("/api/registry/invoke", {
      method: "POST",
      headers,
      body: JSON.stringify({ name, args }),
    });
  }

  callApp(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    return this.request(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  getEvents(query: { since?: string; types?: string[]; projectId?: string; limit?: number } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (query.since) params.set("since", query.since);
    if (query.types?.length) params.set("types", query.types.join(","));
    if (query.projectId) params.set("projectId", query.projectId);
    if (query.limit) params.set("limit", String(query.limit));
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.request(`/api/events${suffix}`);
  }

  searchUserGuide(query: string): Promise<unknown> {
    const params = new URLSearchParams({ q: query });
    return this.request(`/api/help/search?${params.toString()}`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    const apiKey = localServiceApiKey();
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          ...(process.env.VG_WORKSPACE_ID?.trim() ? { "x-workspace-id": process.env.VG_WORKSPACE_ID.trim() } : {}),
          ...init?.headers,
        },
      });
    } catch {
      throw new VideoAgentApiError(
        `Video Agent server is not running at ${this.baseUrl}. ${SERVER_DOWN_GUIDANCE}`,
      );
    }

    const rawBody = await response.text();
    if (!response.ok) {
      throw new VideoAgentApiError(rawBody || response.statusText || "Request failed", rawBody);
    }
    if (!rawBody) return undefined as T;
    try {
      return JSON.parse(rawBody) as T;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new VideoAgentApiError("Video Agent server returned invalid JSON.", rawBody);
    }
  }
}
