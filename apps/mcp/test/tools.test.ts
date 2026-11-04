import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoAgentApiClient } from "../src/apiClient.js";
import { registerVideoAgentTools } from "../src/tools.js";

const projectId = "11111111-1111-4111-8111-111111111111";

const project = {
  id: projectId,
  title: "Test project",
  status: "DRAFT",
  stage: "TOPIC",
  updatedAt: "2026-11-03T00:00:00.000Z",
};

const pipeline = {
  projectId,
  currentStage: "TOPIC",
  status: "DRAFT",
  runMode: null,
  activeJob: null,
  stages: [{ stage: "RESEARCH", state: "PENDING", progress: 0, message: null }],
};

const opened: { server: McpServer; client: Client }[] = [];

async function connect(fetchImpl: typeof fetch = vi.fn() as typeof fetch) {
  const server = new McpServer({ name: "test-video-agent", version: "0.1.0" });
  registerVideoAgentTools(server, new VideoAgentApiClient("http://127.0.0.1:3001", fetchImpl));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  opened.push({ server, client });
  return client;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).flatMap(({ server, client }) => [client.close(), server.close()]));
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("Video Agent MCP tools", () => {
  it("registers all specified tools and three writing prompts", async () => {
    const client = await connect();
    const tools = await client.listTools();
    const prompts = await client.listPrompts();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "apply_review_proposal",
      "approve_scene_visual",
      "create_project",
      "get_auto_report",
      "get_guidelines",
      "get_llm_routes",
      "get_pipeline",
      "get_project",
      "get_project_usage",
      "get_render_export_url",
      "get_research",
      "get_review_context",
      "get_scene_visuals",
      "get_scenes",
      "get_script",
      "get_video_metadata",
      "get_writing_brief",
      "list_profiles",
      "list_projects",
      "list_publications",
      "list_renders",
      "publish_project",
      "recommend_brief",
      "run_pipeline",
      "save_research",
      "save_script",
      "save_story",
      "select_scene_visual",
    ]);
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual([
      "write_research",
      "write_script",
      "write_story",
    ]);
  });

  it("returns active guideline reminders and the disclaimer", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/guidelines/packs")) return jsonResponse({ builtIn: [], custom: [], disclaimer: "ignored" });
      return jsonResponse({
        id: projectId,
        title: "Test project",
        description: "",
        topic: "Cats",
        mode: "ASSISTED",
        status: "DRAFT",
        stage: "TOPIC",
        settings: {
          language: "vi",
          targetDurationSec: 120,
          aspectRatio: "16:9",
          platform: "youtube",
          style: "storytelling",
          tone: "dramatic",
          audience: "general",
          budget: { mode: "BALANCED" },
          wordsPerMinute: 150,
          sceneDurationSec: 7,
          visualStyle: "mixed",
          subtitles: { enabled: true, maxCharsPerLine: 42 },
          music: { enabled: true, volume: 0.15 },
          userSet: [],
          stageExecutors: {},
          autoRender: false,
          guidelines: { platformPack: "auto", channelPacks: ["storytelling"], customRules: [] },
        },
      });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({ name: "get_guidelines", arguments: { projectId } });
    const body = JSON.parse(resultText(result)) as { text: string; disclaimer: string };
    expect(body.text).toContain("(rule: storytelling.arc)");
    expect(body.disclaimer).toContain("không thay thế chính sách chính thức");
  });

  it("reads resolved task routes for a project", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      routes: {
        research: { provider: "mock", model: "research-model", source: "app-task" },
        script: null,
      },
    })) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({ name: "get_llm_routes", arguments: { projectId } });

    expect(JSON.parse(resultText(result))).toEqual({
      routes: {
        research: { provider: "mock", model: "research-model", source: "app-task" },
        script: null,
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/api/projects/${projectId}/llm-routes`,
      { headers: { Accept: "application/json" } },
    );
  });

  it("reads per-project token usage from the usage API", async () => {
    const usage = { projectId, totals: { llmCalls: 2, inputTokens: 10, outputTokens: 5 } };
    const fetchImpl = vi.fn(async () => jsonResponse(usage)) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({ name: "get_project_usage", arguments: { projectId } });
    expect(JSON.parse(resultText(result))).toEqual(usage);
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://127.0.0.1:3001/api/projects/${projectId}/usage`,
      { headers: { Accept: "application/json" } },
    );
  });

  it("reads a compact visual selection and top-five candidate list", async () => {
    const sceneId = "22222222-2222-4222-8222-222222222222";
    const fetchImpl = vi.fn(async () => jsonResponse({
      selection: { candidateId: "33333333-3333-4333-8333-333333333333", status: "REPLACED" },
      status: "NO_VISUAL",
      localFile: null,
      candidates: [{
        id: "33333333-3333-4333-8333-333333333333",
        projectId,
        sceneId,
        origin: "SEARCH",
        provider: "wikimedia",
        providerItemId: "file-1",
        query: "river",
        title: "River",
        description: "",
        tags: [],
        previewUrl: "https://images.test/river-thumb.jpg",
        imageUrl: "https://images.test/river.jpg",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:River.jpg",
        sourceSite: "Wikimedia Commons",
        width: 1200,
        height: 800,
        aspectRatio: 1.5,
        fileType: "jpg",
        watermark: "NONE",
        relevanceScore: 0.8,
        scoreBreakdown: {},
        license: {
          kind: "CC0",
          name: "CC0",
          url: null,
          author: null,
          authorUrl: null,
          attributionRequired: false,
          attributionText: "",
          evidence: "api",
        },
        rank: 0,
        discardedAt: null,
        createdAt: "2026-11-03T00:00:00.000Z",
      }],
    })) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({ name: "get_scene_visuals", arguments: { projectId, sceneId } });
    expect(JSON.parse(resultText(result))).toEqual([{
      sceneId,
      selection: { candidateId: "33333333-3333-4333-8333-333333333333", status: "REPLACED" },
      status: "NO_VISUAL",
      localFile: null,
      candidates: [{
        title: "River",
        provider: "wikimedia",
        size: "1200x800",
        license: "CC0",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:River.jpg",
      }],
    }]);
  });

  it("reads a compact storyboard through get_scenes", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      scenes: [{
        id: "22222222-2222-4222-8222-222222222222",
        projectId,
        order: 0,
        kind: "section",
        sectionId: "intro",
        label: "Introduction",
        narration: "A compact scene narration.",
        visualNotes: "",
        visualQueries: { primary: "city skyline", alternatives: [] },
        musicMood: "",
        energy: "medium",
        estDurationSec: 8,
        durationOverrideSec: null,
        startSec: 0,
        transitionNote: "",
        origin: "AGENT",
        edited: false,
        inputHash: "hash",
        createdAt: "2026-11-03T00:00:00.000Z",
        updatedAt: "2026-11-03T00:00:00.000Z",
      }],
      totalSec: 8,
      targetSec: 120,
      stale: false,
    })) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({ name: "get_scenes", arguments: { projectId } });
    expect(JSON.parse(resultText(result))).toEqual({
      totalSec: 8,
      targetSec: 120,
      stale: false,
      scenes: [{
        order: 0,
        timecode: "00:00",
        label: "Introduction",
        narrationExcerpt: "A compact scene narration.",
        primaryQuery: "city skyline",
      }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(`http://127.0.0.1:3001/api/projects/${projectId}/scenes`, {
      headers: { Accept: "application/json" },
    });
  });

  it("creates projects and previews briefs through the REST API without LLM tools", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/api/recommendations")) {
        return jsonResponse({
          values: { title: "Cats", mode: "ASSISTED", settings: { platform: "tiktok" } },
          recommendations: { platform: { value: "tiktok", reason: "Set by user", source: "user" } },
          warnings: [],
        });
      }
      return jsonResponse({
        ...project,
        title: "Cats",
        settings: { platform: "tiktok" },
        recommendations: { platform: { value: "tiktok", reason: "Set by user", source: "user" } },
        warnings: [],
      }, 201);
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const created = await client.callTool({
      name: "create_project",
      arguments: { topic: "Cats", platform: "tiktok", targetDurationSec: 45 },
    });
    expect(JSON.parse(resultText(created))).toMatchObject({
      id: projectId,
      brief: { platform: "tiktok" },
      recommendations: { platform: { source: "user" } },
    });
    const preview = await client.callTool({
      name: "recommend_brief",
      arguments: { topic: "Cats", platform: "tiktok" },
    });
    expect(JSON.parse(resultText(preview))).toMatchObject({
      values: { settings: { platform: "tiktok" } },
      warnings: [],
    });
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:3001/api/projects",
        body: { topic: "Cats", settings: { platform: "tiktok", targetDurationSec: 45 } },
      },
      {
        url: "http://127.0.0.1:3001/api/recommendations",
        body: { topic: "Cats", settings: { platform: "tiktok" } },
      },
    ]);
  });

  it("lists concise project summaries and passes search filters", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/projects?pageSize=20&q=video&status=DRAFT");
      return jsonResponse({ items: [{ ...project, description: "omitted" }], total: 1, page: 1, pageSize: 20 });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({
      name: "list_projects",
      arguments: { q: "video", status: "DRAFT" },
    });
    expect(JSON.parse(resultText(result))).toEqual({ total: 1, projects: [project] });
  });

  it("saves a story with research first and returns API validation errors verbatim", async () => {
    const calls: string[] = [];
    const validation = '{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":[{"path":["title"],"message":"Required"}]}}';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method}:${url.endsWith("/research") ? "research" : "script"}`);
      if (url.endsWith("/script") && init?.method === "PUT") {
        return new Response(validation, { status: 400 });
      }
      return jsonResponse({ saved: true });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({
      name: "save_story",
      arguments: { projectId, research: { summary: "notes" }, script: { title: "bad" } },
    });
    expect(calls).toEqual(["PUT:research", "PUT:script"]);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(validation);
  });

  it("lists renders and returns a local export URL without streaming", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`http://127.0.0.1:3001/api/projects/${projectId}/renders`);
      return jsonResponse({ renders: [{ id: "22222222-2222-4222-8222-222222222222", version: 1 }] });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const listed = await client.callTool({ name: "list_renders", arguments: { projectId } });
    expect(JSON.parse(resultText(listed))).toEqual({
      renders: [{ id: "22222222-2222-4222-8222-222222222222", version: 1 }],
    });
    const exportUrl = await client.callTool({
      name: "get_render_export_url",
      arguments: { projectId, renderId: "22222222-2222-4222-8222-222222222222" },
    });
    expect(JSON.parse(resultText(exportUrl))).toEqual({
      url: `http://127.0.0.1:3001/api/projects/${projectId}/renders/22222222-2222-4222-8222-222222222222/export`,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the required server-down message", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({ name: "list_projects", arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(
      "Video Agent server is not running at http://127.0.0.1:3001. Start it with `npm run dev`.",
    );
  });

  it("returns the prompt tools with write instructions", async () => {
    const client = await connect();
    const prompt = await client.getPrompt({ name: "write_story", arguments: { projectId } });
    expect(JSON.stringify(prompt.messages)).toContain("save_story");
    expect(JSON.stringify(prompt.messages)).toContain(projectId);
  });
});

function resultText(result: { content: { type: string; text?: string }[] }): string {
  const item = result.content.find((entry) => entry.type === "text");
  if (!item?.text) throw new Error("Expected MCP text result");
  return item.text;
}
