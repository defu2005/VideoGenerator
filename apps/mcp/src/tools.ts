import { PipelineStageSchema, ProjectStatusSchema } from "@vg/shared";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VideoAgentApiClient, VideoAgentApiError } from "./apiClient.js";

type ToolReply = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const projectIdShape = { projectId: z.string().uuid() };

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

export function registerVideoAgentTools(
  server: McpServer,
  api: VideoAgentApiClient = new VideoAgentApiClient(),
): void {
  const briefFields = {
    title: z.string().optional(),
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
    platform?: "youtube" | "youtube_shorts" | "tiktok" | "facebook_reels" | "custom";
    targetDurationSec?: number;
    language?: string;
    style?: "storytelling" | "documentary" | "explainer" | "news" | "listicle";
    tone?: "neutral" | "dramatic" | "inspiring" | "humorous" | "serious";
    audience?: "general" | "kids" | "students" | "professionals";
    aspectRatio?: "16:9" | "9:16" | "1:1";
  }) {
    const { topic, title, ...fields } = input;
    const settings = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    return {
      topic,
      ...(title === undefined ? {} : { title }),
      ...(Object.keys(settings).length ? { settings } : {}),
    };
  }

  server.tool("create_project", "Create a Video Agent project with deterministic video-brief recommendations.", {
    topic: z.string().trim().min(1).max(2000),
    ...briefFields,
  }, (input) => invoke(
    () => api.createProject(briefInput(input)),
    ({ id, title, settings, recommendations }) => ({ id, title, brief: settings, recommendations }),
  ));

  server.tool("recommend_brief", "Preview deterministic video-brief values without creating a project or using an LLM.", {
    topic: z.string().trim().min(1).max(2000),
    ...briefFields,
  }, (input) => invoke(() => api.recommendBrief(briefInput(input))));

  server.tool("list_projects", "List up to 20 Video Agent projects, optionally filtered by title or status.", {
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

  server.tool("get_project", "Get one project and its pipeline stage summary.", projectIdShape, ({ projectId }) => invoke(
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

  server.tool("get_llm_routes", "Read the resolved provider and model route for each LLM task in a project.", projectIdShape, ({ projectId }) =>
    invoke(() => api.getLlmRoutes(projectId)));

  server.tool("get_writing_brief", "Get the exact stage prompt and JSON schema for writing research, a script, or a merged story.", {
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

  server.tool("get_research", "Read the current research notes for a project.", projectIdShape, ({ projectId }) =>
    invoke(async () => (await api.getScript(projectId)).research));

  server.tool("save_research", "Validate and save research notes through the Video Agent API.", {
    ...projectIdShape,
    research: z.unknown(),
  }, ({ projectId, research }) => invoke(() => api.saveResearch(projectId, research)));

  server.tool("get_script", "Read the current script and its origin/version metadata.", projectIdShape, ({ projectId }) =>
    invoke(async () => (await api.getScript(projectId)).script));

  server.tool("get_scenes", "Read the compact storyboard and timing for a project's planned scenes.", projectIdShape, ({ projectId }) =>
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

  server.tool("get_scene_visuals", "Read visual selections and the top five image candidates for a project or scene.", {
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
      candidates: visuals.candidates.slice(0, 5).map((candidate) => ({
        title: candidate.title,
        provider: candidate.provider,
        size: `${candidate.width}x${candidate.height}`,
        license: candidate.license.kind,
        sourceUrl: candidate.sourceUrl,
      })),
    }));
  }));

  server.tool("save_script", "Validate and save a script through the Video Agent API.", {
    ...projectIdShape,
    script: z.unknown(),
  }, ({ projectId, script }) => invoke(() => api.saveScript(projectId, script)));

  server.tool("save_story", "Save merged research notes and script together; research is saved first.", {
    ...projectIdShape,
    research: z.unknown(),
    script: z.unknown(),
  }, ({ projectId, research, script }) => invoke(async () => {
    await api.saveResearch(projectId, research);
    return api.saveScript(projectId, script);
  }));

  server.tool("run_pipeline", "Start Generate All or run one non-gate pipeline stage.", {
    ...projectIdShape,
    stage: PipelineStageSchema.optional(),
  }, ({ projectId, stage }) => invoke(() => api.runPipeline(projectId, stage)));

  server.tool("get_pipeline", "Get pipeline status and all stage states for a project.", projectIdShape, ({ projectId }) =>
    invoke(() => api.getPipeline(projectId)));

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
