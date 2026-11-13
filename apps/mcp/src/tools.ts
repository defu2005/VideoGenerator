import { GUIDELINE_DISCLAIMER, PipelineStageSchema, ProjectStatusSchema, ReviewProposalSchema, activeGuidelines, containsProtectedProject, guidelinePromptBlock } from "@vg/shared";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VideoAgentApiClient, VideoAgentApiError } from "./apiClient.js";

type ToolReply = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const projectIdShape = { projectId: z.string().uuid() };

const APP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const SECRET_PATH = /telegram\/token|omniroute\/token|tts\/secret|youtube-key|app-credentials|connections\/(?:platform-apps|secrets)|oauth\/.+\/(?:start|callback)/i;

function forbiddenAppBody(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = forbiddenAppBody(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(autonomy|grants|budget.*|killed|ownerChatId|audit.*)$/i.test(key)) {
      return "Không đổi quyền tự vận hành, ngân sách hoặc nhật ký qua MCP.";
    }
    if (/^(api[_-]?key|token|password|secret|credentials|paymentMethod|cardNumber)$/i.test(key) && child) {
      return "Không gửi khóa, token hoặc thông tin thanh toán qua MCP.";
    }
    if (key === "allowCopyrightedStills") return "Chỉ người dùng được đổi cho phép ảnh có bản quyền.";
    if (key === "quotaPolicy" && child === "paid_fallback") return "Không bật fallback trả phí qua MCP.";
    if ((key === "paidFallbackDailyUsd" || /spendingLimit|maxSpend|raiseLimit/i.test(key)) && child != null) {
      return "Không nâng hạn mức chi qua MCP.";
    }
    const nested = forbiddenAppBody(child);
    if (nested) return nested;
  }
  return null;
}

function checkAppCall(method: string, path: string, body: unknown): string | null {
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("://")) return "Chỉ gọi đường dẫn /api/ của app.";
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "Đường dẫn API không hợp lệ.";
  }
  if (decoded.includes("\\") || /(?:^|\/)\.{1,2}(?:[/?#]|$)/.test(decoded)) return "Đường dẫn API không hợp lệ.";
  if (method !== "GET" && /\/retrieval\//i.test(decoded) && !/\/profiles\/[^/]+\/search$/.test(decoded)) return "Chỉ người dùng sửa chỉ mục tri thức trong giao diện.";
  if (SECRET_PATH.test(decoded)) return "Đường dẫn này giữ khóa hoặc token. Không gọi qua MCP.";
  if (method !== "GET" && /^\/api\/autonomy(?:\/|$)/i.test(decoded)) return "Chỉ chủ app mới đổi quyền tự vận hành.";
  if (method !== "GET" && /^\/api\/projects\/[^/]+\/(?:pipeline\/gates\/[^/]+\/approve|publications)(?:[/?#]|$)/i.test(decoded)) {
    return "Dùng công cụ registry để duyệt cổng hoặc đăng video.";
  }
  if (method === "DELETE" && /^\/api\/(?:projects|profiles|publications|accounts|retrieval)(?:\/|$)/i.test(decoded)
      && !/^\/api\/profiles\/[^/]+\/topics\/[^/?#]+(?:[?#]|$)/i.test(decoded)) {
    return "Công cụ không được xoá vĩnh viễn dữ liệu.";
  }
  if (method !== "GET" && /\/operator\/profiles\/[^/]+\/memory(?:[/?#]|$)/i.test(decoded)) {
    return "Chỉ người dùng cập nhật ghi nhớ đã xác nhận trong giao diện.";
  }
  if (method !== "GET" && /\/operator\/tool-proposals(?:[/?#]|$)/i.test(decoded)) {
    return "Chỉ người dùng xử lý đề xuất công cụ trong giao diện.";
  }
  if (method !== "GET" && /\/operator\/skills(?:[/?#]|$)/i.test(decoded)) {
    return "Chỉ người dùng duyệt phiên bản skill trong giao diện.";
  }
  if (containsProtectedProject(decoded) || containsProtectedProject(body)) return "Dự án này bị từ chối.";
  if (method === "GET" && body !== undefined) return "GET không kèm body.";
  return forbiddenAppBody(body);
}

function reply(value: unknown, isError = false): ToolReply {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function invoke<T>(action: () => Promise<T>, format: (value: T) => unknown = (value) => value): Promise<ToolReply> {
  try {
    return reply(format(await action()));
  } catch (error) {
    if (error instanceof VideoAgentApiError) return reply(error.rawBody ?? error.message, true);
    return reply(error instanceof Error ? error.message : String(error), true);
  }
}

export type RegistryCatalogTool = {
  name: string;
  description: string;
  risk?: string;
  properties?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
};

export function registerVideoAgentTools(
  server: McpServer,
  api: VideoAgentApiClient = new VideoAgentApiClient(),
  catalog: RegistryCatalogTool[] = [],
): void {
  const operatorOnly = process.env.VG_TOOL_SOURCE === "operator";
  const registered = new Set<string>();
  const registerTool = server.tool.bind(server) as (
    name: string,
    description: string,
    shape: object,
    cb: (args: any) => Promise<ToolReply>,
  ) => void;
  function define(name: string, description: string, shape: object, handler: (args: any) => Promise<ToolReply>): void {
    registered.add(name);
    registerTool(name, description, shape, async (args) => {
      if (name !== "research_scene_visuals" && name !== "dedupe_scene_visuals" && name !== "crop_scene_images" && containsProtectedProject(args)) return reply("Dự án này bị từ chối.", true);
      return handler(args);
    });
  }
  function registerCatalog(): void {
    for (const tool of catalog) {
      if (registered.has(tool.name)) continue;
      let schema: z.ZodType | undefined;
      if (tool.inputSchema) {
        try {
          schema = z.fromJSONSchema(tool.inputSchema);
        } catch {
          // Older catalogs and unsupported keywords still get server-side validation.
        }
      }
      const handler = (args: unknown) => {
        if (tool.name !== "research_scene_visuals" && tool.name !== "dedupe_scene_visuals" && tool.name !== "crop_scene_images" && containsProtectedProject(args)) return Promise.resolve(reply("Dự án này bị từ chối.", true));
        return invoke(() => api.invokeRegistry(tool.name, args));
      };
      if (schema) {
        server.registerTool(tool.name, { description: tool.description, inputSchema: schema }, handler);
        registered.add(tool.name);
        continue;
      }
      const shape: Record<string, z.ZodType> = {};
      for (const key of Object.keys(tool.properties ?? {})) {
        const optional = key.endsWith("?");
        const field = optional ? key.slice(0, -1) : key;
        if (!field) continue;
        shape[field] = optional ? z.any().optional() : z.any();
      }
      if (Object.keys(shape).length === 0) shape.payload = z.record(z.string(), z.any()).optional();
      define(tool.name, tool.description, shape, handler);
    }
  }
  if (operatorOnly) {
    registerCatalog();
    return;
  }
  const briefFields = {
    title: z.string().optional(),
    profileId: z.string().uuid().optional(),
    platform: z.enum(["youtube", "youtube_shorts", "tiktok", "facebook_reels", "custom"]).optional(),
    targetDurationSec: z.number().int().min(30).max(1800).optional(),
    language: z.string().optional(),
    style: z.enum(["storytelling", "documentary", "explainer", "news", "listicle"]).optional(),
    tone: z.enum(["neutral", "dramatic", "inspiring", "humorous", "serious"]).optional(),
    audience: z.enum(["general", "kids", "students", "professionals"]).optional(),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  };
  function briefInput(input: {
    topic: string;
    title?: string;
    profileId?: string;
    platform?: "youtube" | "youtube_shorts" | "tiktok" | "facebook_reels" | "custom";
    targetDurationSec?: number;
    language?: string;
    style?: "storytelling" | "documentary" | "explainer" | "news" | "listicle";
    tone?: "neutral" | "dramatic" | "inspiring" | "humorous" | "serious";
    audience?: "general" | "kids" | "students" | "professionals";
    aspectRatio?: "16:9" | "9:16" | "1:1";
  }) {
    const { topic, title, profileId, ...fields } = input;
    const settings = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    return {
      topic,
      ...(title === undefined ? {} : { title }),
      ...(profileId === undefined ? {} : { profileId }),
      ...(Object.keys(settings).length ? { settings } : {}),
    };
  }

  define("list_profiles", "List Video Agent profiles (Hồ sơ) with account and project counts.", {
    includeArchived: z.boolean().optional(),
  }, ({ includeArchived }) => invoke(
    () => api.listProfiles({ includeArchived }),
    ({ items }) => ({
      profiles: items.map(({ id, name, language, color, accountCount, projectCount, archivedAt }) => ({
        id,
        name,
        language,
        color,
        accountCount,
        projectCount,
        archivedAt,
      })),
    }),
  ));

  define("create_project", "Create a Video Agent project with deterministic video-brief recommendations.", {
    topic: z.string().trim().min(1).max(2000),
    ...briefFields,
  }, (input) => invoke(
    () => api.createProject(briefInput(input)),
    ({ id, title, settings, recommendations }) => ({ id, title, brief: settings, recommendations }),
  ));

  define("recommend_brief", "Preview deterministic video-brief values without creating a project or using an LLM.", {
    topic: z.string().trim().min(1).max(2000),
    ...briefFields,
  }, (input) => invoke(() => api.recommendBrief(briefInput(input))));

  define("list_projects", "List up to 20 Video Agent projects, optionally filtered by title or status.", {
    q: z.string().optional(),
    status: ProjectStatusSchema.optional(),
  }, ({ q, status }) => invoke(
    () => api.listProjects({ q, status }),
    ({ items, total }) => ({
      total,
      projects: items.map(({ id, title, status: projectStatus, stage, updatedAt }) => ({
        id,
        title,
        status: projectStatus,
        stage,
        updatedAt,
      })),
    }),
  ));

  define("get_project", "Get one project and its pipeline stage summary.", projectIdShape, ({ projectId }) => invoke(
    async () => {
      const [project, pipeline] = await Promise.all([api.getProject(projectId), api.getPipeline(projectId)]);
      return {
        project,
        pipeline: {
          currentStage: pipeline.currentStage,
          status: pipeline.status,
          stages: pipeline.stages.map(({ stage, state, progress, message }) => ({ stage, state, progress, message })),
        },
      };
    },
  ));

  define("compose_plan_preview", "Read the compose shot plan and stats. Does not change the project.", projectIdShape, ({ projectId }) => invoke(
    () => api.getComposePlan(projectId),
  ));

  define("get_guidelines", "Read the active content-guideline reminders for a project, plus the disclaimer. This does not call an LLM.", projectIdShape, ({ projectId }) => invoke(
    async () => {
      const [project, packs] = await Promise.all([api.getProject(projectId), api.getGuidelinePacks()]);
      const targets = ["script", "visuals", "music", "subtitles", "metadata"] as const;
      return {
        text: guidelinePromptBlock(activeGuidelines(project, packs.custom), targets),
        disclaimer: GUIDELINE_DISCLAIMER,
      };
    },
  ));

  define("get_llm_quota_status", "Read free-model quota usage, cool-downs, and the wait-or-paid policy.", {}, () =>
    invoke(() => api.getLlmQuotaStatus()));

  define("get_llm_health", "Read which LLM providers are cooling down after a quota or rate limit (until when) and recent automatic failovers.", {}, () =>
    invoke(() => api.getLlmHealth()));

  define("search_user_guide", "Search the Vietnamese user guide and return the best-matching sections.", {
    query: z.string().trim().min(1).max(200),
  }, ({ query }) => invoke(() => api.searchUserGuide(query)));

  define("list_vision_models", "Đọc provider có sẵn khả năng nhìn ảnh, quy tắc Grok trên OmniRoute, và các model đã đánh dấu vision.", {}, () =>
    invoke(async () => {
      const marked = await api.getVisionMarks();
      return {
        builtinProviders: ["anthropic", "gemini", "claude-cli", "copilot-cli"],
        omnirouteVision: "Model OmniRoute Grok 4 trở lên được tính là nhìn ảnh. Ví dụ grok-cli/grok-4.7.",
        marked: marked.models,
        appRouting: await api.getAppLlmRouting(),
      };
    }));

  define("set_stage_timeout", "Tính lại thời gian tối đa từng bước, hoặc đặt một bước theo giây. timeoutSec null trả bước đó về mức ước lượng.", {
    ...projectIdShape,
    recompute: z.boolean().optional(),
    stage: z.string().min(1).max(40).optional(),
    timeoutSec: z.number().positive().nullable().optional(),
  }, ({ projectId, recompute, stage, timeoutSec }) => {
    if (containsProtectedProject(projectId)) return Promise.resolve(reply("Dự án này bị từ chối.", true));
    if (recompute) return invoke(() => api.recomputeStageTimeouts(projectId));
    if (!stage || timeoutSec === undefined) return Promise.resolve(reply("Cần recompute=true hoặc cả stage và timeoutSec.", true));
    return invoke(() => api.setStageTimeout(projectId, stage, timeoutSec));
  });

  define("retry_stage", "Chạy lại một bước pipeline đang FAILED. Không tự chạy khi quota gần hết và chính sách là chờ reset.", {
    ...projectIdShape,
    stage: PipelineStageSchema,
  }, ({ projectId, stage }) => {
    if (containsProtectedProject(projectId)) return Promise.resolve(reply("Dự án này bị từ chối.", true));
    return invoke(() => api.retryStage(projectId, stage));
  });

  define("set_llm_models", "Gán provider và model cho một tác vụ, cho mặc định, hoặc cho nhóm vision (visionCheck, visionConsistency, renderVision, thumbnailPick). Model gán cho việc đọc ảnh được đánh dấu vision nếu provider chưa hỗ trợ ảnh. Grok 4 trên OmniRoute, ví dụ grok-cli/grok-4.7, được tính là nhìn ảnh.", {
    scope: z.enum(["app", "project"]).optional(),
    projectId: z.string().uuid().optional(),
    assignments: z.array(z.object({
      task: z.string().min(1).max(40),
      provider: z.string().min(1).max(80),
      model: z.string().min(1).max(200),
    })).min(1).max(40),
  }, ({ scope, projectId, assignments }) => {
    if (containsProtectedProject(projectId)) return Promise.resolve(reply("Dự án này bị từ chối.", true));
    return invoke(() => api.assignLlmRoutes({
      ...(scope ? { scope } : {}),
      ...(projectId ? { projectId } : {}),
      assignments,
    }));
  });
  define("get_llm_routes", "Read the resolved provider and model route for each LLM task in a project.", projectIdShape, ({ projectId }) =>
    invoke(() => api.getLlmRoutes(projectId)));

  define("get_project_usage", "Read token, call, cost, provider, model, stage, task, and run usage for one project.", projectIdShape, ({ projectId }) =>
    invoke(() => api.getProjectUsage(projectId)));

  define("get_writing_brief", "Get the exact stage prompt and JSON schema for writing research, a script, or a merged story.", {
    ...projectIdShape,
    stage: z.enum(["RESEARCH", "SCRIPT", "STORY"]),
  }, ({ projectId, stage }) => invoke(
    async () => {
      const [brief, scriptData] = await Promise.all([
        api.getPrompt(projectId, stage),
        stage === "SCRIPT" ? api.getScript(projectId) : Promise.resolve(null),
      ]);
      return {
        ...brief,
        ...(stage === "SCRIPT" ? { currentResearch: scriptData?.research?.data ?? null } : {}),
      };
    },
  ));

  define("get_research", "Read the current research notes for a project.", projectIdShape, ({ projectId }) =>
    invoke(async () => (await api.getScript(projectId)).research));

  define("save_research", "Validate and save research notes through the Video Agent API.", {
    ...projectIdShape,
    research: z.unknown(),
  }, ({ projectId, research }) => invoke(() => api.saveResearch(projectId, research)));

  define("get_script", "Read the current script and its origin/version metadata.", projectIdShape, ({ projectId }) =>
    invoke(async () => (await api.getScript(projectId)).script));

  define("get_scenes", "Read the compact storyboard and timing for a project's planned scenes.", projectIdShape, ({ projectId }) =>
    invoke(async () => {
      const { scenes, totalSec, targetSec, stale } = await api.getScenes(projectId);
      return {
        totalSec,
        targetSec,
        stale,
        scenes: scenes.map((scene) => ({
          order: scene.order,
          timecode: `${String(Math.floor(scene.startSec / 60)).padStart(2, "0")}:${String(Math.floor(scene.startSec % 60)).padStart(2, "0")}`,
          label: scene.label,
          narrationExcerpt: scene.narration.trim().slice(0, 180),
          primaryQuery: scene.visualQueries.primary,
        })),
      };
    }));

  define("get_scene_visuals", "Read visual selections and the top five image candidates for a project or scene.", {
    ...projectIdShape,
    sceneId: z.string().uuid().optional(),
  }, ({ projectId, sceneId }) => invoke(async () => {
    const records = sceneId
      ? [{ sceneId, visuals: await api.getSceneVisuals(projectId, sceneId) }]
      : await Promise.all((await api.getProjectVisuals(projectId)).scenes.map(async (scene) => ({
        sceneId: scene.sceneId,
        visuals: await api.getSceneVisuals(projectId, scene.sceneId),
      })));
    return records.map(({ sceneId: id, visuals }) => ({
      sceneId: id,
      selection: visuals.selection
        ? { candidateId: visuals.selection.candidateId, status: visuals.selection.status }
        : null,
      status: visuals.status ?? "NO_VISUAL",
      localFile: visuals.selection
        ? visuals.candidates.find((candidate) => candidate.id === visuals.selection?.candidateId)?.localPath ?? null
        : null,
      candidates: visuals.candidates.slice(0, 5).map((candidate) => ({
        title: candidate.title,
        provider: candidate.provider,
        size: `${candidate.width}x${candidate.height}`,
        license: candidate.license.kind,
        sourceUrl: candidate.sourceUrl,
      })),
    }));
  }));

  define("approve_scene_visual", "Download and approve the selected image for one scene.", {
    ...projectIdShape,
    sceneId: z.string().uuid(),
  }, ({ projectId, sceneId }) => invoke(() => api.approveSceneVisual(projectId, sceneId)));

  define("select_scene_visual", "Select an existing candidate image for one scene; approval is still required.", {
    ...projectIdShape,
    sceneId: z.string().uuid(),
    candidateId: z.string().uuid(),
  }, ({ projectId, sceneId, candidateId }) => invoke(() => api.selectSceneVisual(projectId, sceneId, candidateId)));

  define("save_script", "Validate and save a script through the Video Agent API.", {
    ...projectIdShape,
    script: z.unknown(),
  }, ({ projectId, script }) => invoke(() => api.saveScript(projectId, script)));

  define("save_story", "Save merged research notes and script together; research is saved first.", {
    ...projectIdShape,
    research: z.unknown(),
    script: z.unknown(),
  }, ({ projectId, research, script }) => invoke(async () => {
    await api.saveResearch(projectId, research);
    return api.saveScript(projectId, script);
  }));

  define("run_pipeline", "Start Generate All or run one non-gate pipeline stage.", {
    ...projectIdShape,
    stage: PipelineStageSchema.optional(),
  }, ({ projectId, stage }) => invoke(() => api.invokeRegistry("run_pipeline", {
    projectId,
    ...(stage === undefined ? {} : { stage }),
  })));

  define("get_pipeline", "Get pipeline status and all stage states for a project.", projectIdShape, ({ projectId }) =>
    invoke(() => api.getPipeline(projectId)));

  define("get_video_metadata", "Read publishing metadata (titles, description, tags) for a project.", projectIdShape, ({ projectId }) =>
    invoke(() => api.getVideoMetadata(projectId)));

  define("get_auto_report", "Read AUTO-mode decision report entries (grouped by stage) for a project.", projectIdShape, ({ projectId }) =>
    invoke(() => api.getAutoReport(projectId)));

  define("get_events", "Đọc sự kiện agent: bước, duyệt, quota, đăng.", {
    since: z.string().optional(),
    types: z.array(z.string()).optional(),
    projectId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }, (args) => invoke(() => api.getEvents(args)));

  server.registerResource("events", "vg://events", { description: "Sự kiện agent gần đây" }, async (uri) => {
    const events = await api.getEvents({});
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(events) }] };
  });

  define("list_renders", "List render versions for a project (newest first), including deleted ones.", projectIdShape, ({ projectId }) =>
    invoke(() => api.listRenders(projectId)));

  define("publish_project", "Queue publish jobs for selected platform accounts (optional schedule).", {
    ...projectIdShape,
    accountIds: z.array(z.string().uuid()).min(1),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    visibility: z.enum(["public", "unlisted", "private"]).optional(),
    force: z.boolean().optional(),
  }, ({ projectId, accountIds, scheduledFor, visibility, force }) => invoke(
    () => api.invokeRegistry("publish_project", {
      projectId,
      body: {
        accountIds,
        ...(scheduledFor === undefined ? {} : { scheduledFor }),
        ...(visibility === undefined ? {} : { visibility }),
        ...(force === undefined ? {} : { force }),
      },
    }),
  ));

  define("list_publications", "List publications across projects, optionally filtered by status or profile.", {
    status: z.enum(["QUEUED", "SCHEDULED", "UPLOADING", "PUBLISHED", "FAILED", "CANCELLED"]).optional(),
    profileId: z.string().uuid().optional(),
  }, ({ status, profileId }) => invoke(() => api.listPublications({ status, profileId })));

  define("list_topics", "List topic-queue items for a profile.", {
    profileId: z.string().uuid(),
    status: z.enum(["PENDING", "APPROVED", "IN_PRODUCTION", "DONE", "REJECTED", "FAILED"]).optional(),
  }, ({ profileId, status }) => invoke(() => api.listTopics(profileId, status)));

  define("add_topic", "Add a topic to a profile queue.", {
    profileId: z.string().uuid(),
    topic: z.string().min(1).max(500),
    notes: z.string().max(2000).nullable().optional(),
    status: z.enum(["PENDING", "APPROVED"]).optional(),
  }, ({ profileId, topic, notes, status }) => invoke(() => api.addTopic(profileId, {
    topic,
    ...(notes === undefined ? {} : { notes }),
    ...(status === undefined ? {} : { status }),
  })));

  define("suggest_topics", "Ask the LLM to suggest topics for a profile (mock in tests).", {
    profileId: z.string().uuid(),
    hint: z.string().max(1000).optional(),
    count: z.number().int().min(1).max(20).optional(),
  }, ({ profileId, hint, count }) => invoke(() => api.suggestTopics(profileId, {
    ...(hint === undefined ? {} : { hint }),
    ...(count === undefined ? {} : { count }),
  })));

  define("approve_topics", "Approve or reject topic-queue items in bulk.", {
    profileId: z.string().uuid(),
    ids: z.array(z.string().uuid()).min(1),
    status: z.enum(["APPROVED", "REJECTED"]),
  }, ({ profileId, ids, status }) => invoke(() => api.approveTopics(profileId, { ids, status })));

  define("automation_status", "Read global automation pause state and per-profile queue/slot summary.", {}, () =>
    invoke(() => api.automationStatus()));

  define("get_render_export_url", "Return the local HTTP URL to download a render export zip (does not stream the zip).", {
    ...projectIdShape,
    renderId: z.string().uuid(),
  }, ({ projectId, renderId }) => invoke(async () => api.getRenderExportUrl(projectId, renderId)));

  define("get_review_context", "Read the compact pre-render review context document for a project (0 LLM tokens).", projectIdShape, ({ projectId }) =>
    invoke(() => api.getReviewContext(projectId)));

  define("app_api", "Gọi mọi API còn lại của Video Agent: cảnh, ảnh, giọng, nhạc, timeline, đồ họa, thumbnail, render, metadata, review, timeout, nhà cung cấp, hồ sơ, bình luận, tài chính, thống kê, operator. method + path bắt đầu bằng /api/, body JSON tùy chọn. Không gửi token, khóa, fallback trả phí, hoặc dự án bị bảo vệ.", {
    method: z.enum(APP_METHODS),
    path: z.string().trim().min(5).max(400),
    body: z.unknown().optional(),
  }, ({ method, path, body }) => {
    const blocked = checkAppCall(method, path, body);
    if (blocked) return Promise.resolve(reply(blocked, true));
    return invoke(() => api.callApp(method, path, body));
  });

  define("apply_review_proposal", "Validate and apply one pre-render review proposal without storing a chat message.", {
    ...projectIdShape,
    proposal: ReviewProposalSchema,
  }, ({ projectId, proposal }) => invoke(() => api.applyReviewProposal(projectId, proposal)));

  registerCatalog();

  server.prompt("write_research", "Ask Claude to write research notes and save them in Video Agent.", {
    projectId: z.string().uuid(),
  }, ({ projectId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Call get_writing_brief with projectId "${projectId}" and stage "RESEARCH". Write research in the project's language, preserve uncertainty, and save it with save_research.`,
      },
    }],
  }));

  server.prompt("write_script", "Ask Claude to write a script and save it in Video Agent.", {
    projectId: z.string().uuid(),
  }, ({ projectId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Call get_writing_brief with projectId "${projectId}" and stage "SCRIPT". Write the script in the project's language and save it with save_script.`,
      },
    }],
  }));

  server.prompt("write_story", "Ask Claude to write merged research and script in one response and save both.", {
    projectId: z.string().uuid(),
  }, ({ projectId }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Call get_writing_brief with projectId "${projectId}" and stage "STORY". Write research and script in the project's language, then save both with one save_story call.`,
      },
    }],
  }));
}
