import type {
  CreateProjectInput,
  CreateProjectResponse,
  ProjectListResponse,
  Project,
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

  getGuidelinePacks(): Promise<{ builtIn: GuidelinePack[]; custom: GuidelinePack[]; disclaimer: string }> {
    return this.request("/api/guidelines/packs");
  }

  getProject(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}`);
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

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
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
