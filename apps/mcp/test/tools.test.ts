import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { VideoAgentApiClient } from "../src/apiClient.js";
import { registerVideoAgentTools, type RegistryCatalogTool } from "../src/tools.js";

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

async function connect(fetchImpl: typeof fetch = vi.fn() as typeof fetch, catalog: RegistryCatalogTool[] = []) {
  const server = new McpServer({ name: "test-video-agent", version: "0.1.0" });
  registerVideoAgentTools(server, new VideoAgentApiClient("http://127.0.0.1:3001", fetchImpl), catalog);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  opened.push({ server, client });
  return client;
}

beforeEach(() => {
  vi.stubEnv("VG_API_KEY", "");
  vi.stubEnv("DATA_DIR", join(tmpdir(), "vg-mcp-no-local-key"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(opened.splice(0).flatMap(({ server, client }) => [client.close(), server.close()]));
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("Video Agent MCP tools", () => {
  it("returns stored candidate previews as native MCP image content", async () => {
    const image = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
    const fetchImpl = vi.fn(async () => jsonResponse({ result: { content: [image], sha256: "a".repeat(64) } }));
    const client = await connect(fetchImpl, [{ name: "visual_get_candidate_image", description: "Stored image", properties: { candidateId: "uuid", "maxSide?": "number" } }]);
    const result = await client.callTool({ name: "visual_get_candidate_image", arguments: { candidateId: projectId, maxSide: 768 } });
    expect(result.content).toEqual([image, { type: "text", text: `SHA256 ảnh gốc: ${"a".repeat(64)}` }]);
  });
  it.each(["preview_frame", "preview_contact_sheet"])("returns %s as a native image while preserving text, facts and metadata without duplicated base64", async (name) => {
    const data = readFileSync(new URL("../../server/test/fixtures/images/tiny.jpg", import.meta.url)).toString("base64");
    const image = { type: "image", mimeType: "image/jpeg", data };
    const text = { type: "text", text: "Ảnh xem trước; kiểm tra vùng chữ an toàn." };
    const metadata = { kind: name === "preview_frame" ? "frame" : "contact_sheet", basis: "selection", cached: false,
      file: { id: "fixture-file", name: "fixture.jpg", url: `/api/projects/${projectId}/preview/fixture.jpg`, mime: "image/jpeg" },
      width: 480, height: 270, elapsedMs: 12, notes: ["Timeline chưa hoàn tất"], warnings: ["safe-area"],
      facts: [{ kind: "title", text: "Nội dung", averageLuma: 50, safeAreaOverflow: true, pHash: "fixture-hash" }],
      tiles: [{ sceneIndex: 0, atSec: 1.2 }], atSec: 1.2 };
    const fetchImpl = vi.fn(async () => jsonResponse({ result: { ...metadata, content: [text, image] }, summaryVi: "Xem trước nhanh" }));
    const client = await connect(fetchImpl, [{ name, description: "Preview", inputSchema: {
      type: "object", properties: { projectId: { type: "string", format: "uuid" } }, required: ["projectId"],
    } }]);
    const result = await client.callTool({ name, arguments: { projectId } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([text, image, { type: "text", text: JSON.stringify({ summaryVi: "Xem trước nhanh", result: metadata }) }]);
    expect(resultText(result)).not.toContain(data);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({ name, args: { projectId } });
  });

  it.each(["preview_frame", "preview_contact_sheet", "preview_clip"])("keeps the URL-only %s result and facts intact", async (name) => {
    const response = { result: { kind: name === "preview_clip" ? "clip" : "frame", basis: "timeline", cached: true,
      file: { id: "fixture", url: `/api/projects/${projectId}/preview/fixture`, mime: name === "preview_clip" ? "video/mp4" : "image/jpeg" },
      facts: [{ kind: "still", averageLuma: 100 }], durationSec: name === "preview_clip" ? 3 : undefined } };
    const client = await connect(vi.fn(async () => jsonResponse(response)), [{ name, description: "URL preview", properties: { projectId: "uuid" } }]);
    const result = await client.callTool({ name, arguments: { projectId } });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
    expect(JSON.parse(resultText(result))).toEqual(JSON.parse(JSON.stringify(response)));
  });

  it("preserves an image tool's pending-action envelope", async () => {
    const response = { pendingActionId: "pending-fixture", summaryVi: "Chưa có ảnh" };
    const client = await connect(vi.fn(async () => jsonResponse(response)), [{ name: "preview_frame", description: "Preview" }]);
    const result = await client.callTool({ name: "preview_frame", arguments: {} });
    expect(JSON.parse(resultText(result))).toEqual(response);
  });

  it("returns preview images through the operator-only catalog path as well", async () => {
    vi.stubEnv("VG_TOOL_SOURCE", "operator");
    const image = { type: "image", mimeType: "image/jpeg",
      data: readFileSync(new URL("../../server/test/fixtures/images/tiny.jpg", import.meta.url)).toString("base64") };
    const client = await connect(vi.fn(async () => jsonResponse({ result: { content: [image], basis: "timeline" } })),
      [{ name: "preview_frame", description: "Operator preview", properties: { projectId: "uuid" } }]);
    const result = await client.callTool({ name: "preview_frame", arguments: { projectId } });
    expect(result.content).toEqual([image, { type: "text", text: JSON.stringify({ result: { basis: "timeline" } }) }]);
  });

  it("keeps the candidate SHA256 contract when validating native image results", async () => {
    const image = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
    const client = await connect(vi.fn(async () => jsonResponse({ result: { content: [image], sha256: "invalid-hash" } })),
      [{ name: "visual_get_candidate_image", description: "Candidate" }]);
    const result = await client.callTool({ name: "visual_get_candidate_image", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Máy chủ trả dữ liệu ảnh MCP không hợp lệ." }]);
  });

  it.each([
    { mimeType: "image/jpeg", data: "not base64!" },
    { mimeType: "image/jpeg", data: "ab==" }, // Noncanonical unused bits.
    { mimeType: "image/jpeg", data: "" },
    { mimeType: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") },
    { mimeType: "image/jpeg", data: Buffer.from("not an image").toString("base64") },
    { mimeType: "image/jpeg", data: "iVBORw0KGgo=" }, // PNG signature declared as JPEG.
    { mimeType: "image/png", data: "data:image/png;base64,iVBORw0KGgo=" },
  ])("rejects invalid preview MIME/base64/image signature without echoing image payload ($mimeType, $data)", async (image) => {
    const client = await connect(vi.fn(async () => jsonResponse({ result: { content: [{ type: "image", ...image }] } })),
      [{ name: "preview_contact_sheet", description: "Preview" }]);
    const result = await client.callTool({ name: "preview_contact_sheet", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Máy chủ trả dữ liệu ảnh MCP không hợp lệ." }]);
  });

  it("preserves candidate image hashes and additional metadata/text through the shared image path", async () => {
    const image = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
    const client = await connect(vi.fn(async () => jsonResponse({ result: { content: [image, { type: "text", text: "Candidate note" }], sha256: "b".repeat(64), width: 1 }, summaryVi: "Ảnh gốc" })),
      [{ name: "visual_get_candidate_image", description: "Candidate" }]);
    const result = await client.callTool({ name: "visual_get_candidate_image", arguments: {} });
    expect(result.content).toEqual([image, { type: "text", text: "Candidate note" },
      { type: "text", text: `SHA256 ảnh gốc: ${"b".repeat(64)}` },
      { type: "text", text: JSON.stringify({ summaryVi: "Ảnh gốc", result: { width: 1 } }) }]);
  });

  it("keeps registry API failures as MCP errors on the image path", async () => {
    const client = await connect(vi.fn(async () => jsonResponse({ error: { code: "PREVIEW_BUSY", message: "Thử lại sau" } }, 503)),
      [{ name: "preview_frame", description: "Preview" }]);
    const result = await client.callTool({ name: "preview_frame", arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("PREVIEW_BUSY");
  });
  it("registers all specified tools and three writing prompts", async () => {
    const client = await connect();
    const tools = await client.listTools();
    const prompts = await client.listPrompts();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "add_topic",
      "app_api",
      "apply_review_proposal",
      "approve_scene_visual",
      "approve_topics",
      "automation_status",
      "compose_plan_preview",
      "create_project",
      "get_auto_report",
      "get_events",
      "get_guidelines",
      "get_llm_health",
      "get_llm_quota_status",
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
      "get_script_draft",
      "get_stage_lessons",
      "get_video_metadata",
      "get_writing_brief",
      "list_profiles",
      "list_projects",
      "list_publications",
      "list_renders",
      "list_topics",
      "list_vision_models",
      "publish_project",
      "recommend_brief",
      "rescore_script",
      "retry_stage",
      "run_pipeline",
      "save_research",
      "save_script",
      "save_story",
      "search_user_guide",
      "select_scene_visual",
      "set_llm_models",
      "set_stage_timeout",
      "stage_quality_report",
      "suggest_topics",
      "switch_script_hook",]);
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

  it("search_user_guide calls the help search API", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/api/help/search?");
      expect(url).toContain("q=");
      return jsonResponse({
        query: "telegram",
        sections: [{
          page: "tro-ly-va-telegram",
          anchor: "telegram",
          title: "Kết nối Telegram",
          text: "Ghép nối",
          href: "/help/tro-ly-va-telegram#telegram",
        }],
      });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({ name: "search_user_guide", arguments: { query: "kết nối Telegram" } });
    const body = JSON.parse(resultText(result)) as { sections: Array<{ anchor: string }> };
    expect(body.sections[0]?.anchor).toBe("telegram");
  });

  it("exposes only registry tools to the background operator", async () => {
    vi.stubEnv("VG_TOOL_SOURCE", "operator");
    vi.stubEnv("VG_OPERATOR_MANAGED", "1");
    vi.stubEnv("VG_OPERATOR_INVOCATION", "fixture-invocation");
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-vg-tool-source")).toBe("operator");
      expect(new Headers(init?.headers).get("x-vg-operator-managed")).toBe("1");
      expect(new Headers(init?.headers).get("x-vg-operator-invocation")).toBe("fixture-invocation");
      return jsonResponse({ pendingActionId: "fixture-confirmation" });
    });
    const client = await connect(fetchImpl as typeof fetch, [{
      name: "create_project", description: "Registry version", properties: { topic: "string" },
    }]);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["create_project"]);
    const result = await client.callTool({ name: "create_project", arguments: { topic: "Thử" } });
    expect(resultText(result)).toContain("fixture-confirmation");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/api/registry/invoke");
  });

  it("advertises and validates the full input schema for a registry tool", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: { ok: true } }));
    const client = await connect(fetchImpl as typeof fetch, [{
      name: "fixture_registry_tool",
      description: "Fixture registry tool",
      inputSchema: {
        type: "object",
        properties: { count: { type: "integer", minimum: 1 } },
        required: ["count"],
        additionalProperties: false,
      },
    }]);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "fixture_registry_tool")?.inputSchema).toMatchObject({
      properties: { count: { type: "integer", minimum: 1 } },
      required: ["count"],
    });
    expect((await client.callTool({ name: "fixture_registry_tool", arguments: { count: 0 } })).isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await client.callTool({ name: "fixture_registry_tool", arguments: { count: 1 } })).isError).toBeFalsy();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("exposes propose_skill from the registry catalog and sends it through the registry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: { name: "video-moi", version: 1, status: "draft" } }));
    const client = await connect(fetchImpl as typeof fetch, [{
      name: "propose_skill",
      description: "Đề xuất skill nháp",
      inputSchema: {
        type: "object",
        properties: { markdown: { type: "string" }, reason: { type: "string" } },
        required: ["markdown", "reason"],
        additionalProperties: false,
      },
    }]);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("propose_skill");
    const result = await client.callTool({ name: "propose_skill", arguments: { markdown: "---\nname: video-moi\n---", reason: "lặp lại" } });
    expect(resultText(result)).toContain("draft");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/api/registry/invoke");
  });

  it("gates confirm tools through the registry and refuses the protected project", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/api/registry/invoke");
      const body = JSON.parse(String(init?.body)) as { name: string };
      expect(body.name).toBe("publish_project");
      return jsonResponse({ pendingActionId: "pending-1", summaryVi: "Đăng video lên nền tảng" });
    }) as typeof fetch;
    const server = new McpServer({ name: "test-video-agent", version: "0.1.0" });
    registerVideoAgentTools(server, new VideoAgentApiClient("http://127.0.0.1:3001", fetchImpl), [{
      name: "find_skills",
      description: "Tìm kỹ năng",
      properties: { query: "string" },
    }, {
      name: "get_stage_timeouts",
      description: "Đọc thời gian chờ",
      inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"], additionalProperties: false },
    }, {
      name: "update_stage_timeouts",
      description: "Đề xuất thời gian chờ",
      inputSchema: { type: "object", properties: { projectId: { type: "string" }, stages: { type: "object" } }, required: ["projectId", "stages"], additionalProperties: false },
    }]);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    opened.push({ server, client });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("find_skills");
    expect(names).toContain("get_stage_timeouts");
    expect(names).toContain("update_stage_timeouts");
    const published = await client.callTool({
      name: "publish_project",
      arguments: {
        projectId,
        accountIds: ["22222222-2222-4222-8222-222222222222"],
      },
    });
    expect(resultText(published)).toContain("pending-1");
    const refused = await client.callTool({
      name: "get_project",
      arguments: { projectId: PROTECTED_PROJECT_ID },
    });
    expect(refused.isError).toBe(true);
    expect(resultText(refused)).toMatch(/từ chối/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("app_api calls an allowed route and refuses secrets", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/api/projects/");
      expect(init?.method).toBe("PATCH");
      return jsonResponse({ ok: true });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const ok = await client.callTool({
      name: "app_api",
      arguments: {
        method: "PATCH",
        path: `/api/projects/${projectId}/stage-timeouts`,
        body: { RENDER: 120000 },
      },
    });
    expect(resultText(ok)).toContain("ok");
    const secret = await client.callTool({
      name: "app_api",
      arguments: { method: "PUT", path: "/api/notifications/telegram/token", body: { token: "x" } },
    });
    expect(secret.isError).toBe(true);
    for (const [method, path] of [
      ["POST", "/api/autonomy/app"],
      ["DELETE", `/api/projects/${projectId}`],
      ["POST", `/api/projects/${projectId}/pipeline/gates/SCRIPT/approve`],
      ["POST", `/api/projects/${projectId}/publications`],
    ]) {
      const blocked = await client.callTool({ name: "app_api", arguments: { method, path } });
      expect(blocked.isError, path).toBe(true);
    }
    for (const path of [
      "/api/connections/platform-apps/youtube",
      "/api/connections/platform-apps/youtube/verify",
      "/api/oauth/youtube/start",
      "/api/profiles/profile/accounts/account/app-credentials",
    ]) {
      const blocked = await client.callTool({ name: "app_api", arguments: { method: "GET", path } });
      expect(blocked.isError, path).toBe(true);
    }
    const memory = await client.callTool({
      name: "app_api",
      arguments: { method: "POST", path: `/api/operator/profiles/${projectId}/%6demory`, body: { text: "Thử" } },
    });
    expect(memory.isError).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("app_api reads the in-progress and done proposal lists and refuses every write to tool proposals", async () => {
    const requests: { method: string; url: string }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return jsonResponse({ items: [{ id: "33333333-3333-4333-8333-333333333333", name: "done_a", taskRef: "TASK-A" }] });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    for (const path of ["/api/operator/tool-proposals/in-progress", "/api/operator/tool-proposals/done"]) {
      const read = await client.callTool({ name: "app_api", arguments: { method: "GET", path } });
      expect(read.isError, path).not.toBe(true);
      expect(resultText(read), path).toContain("TASK-A");
    }
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /api/operator/tool-proposals/in-progress",
      "GET /api/operator/tool-proposals/done",
    ]);

    const id = "22222222-2222-4222-8222-222222222222";
    const writes = [
      `/api/operator/tool-proposals/${id}/start`,
      `/api/operator/tool-proposals/${id}/check-done`,
      `/api/operator/tool-proposals/${id}/accept`,
      `/api/operator/tool-proposals/${id}/draft`,
      `/api/operator/tool-proposals/${id}/dismiss`,
      `/api/operator/tool%2Dproposals/${id}/check-done`,
    ];
    for (const path of writes) {
      const blocked = await client.callTool({ name: "app_api", arguments: { method: "POST", path, body: { task: "TASK-X" } } });
      expect(blocked.isError, path).toBe(true);
      expect(resultText(blocked), path).toContain("Chỉ người dùng xử lý đề xuất công cụ trong giao diện.");
    }
    expect(requests).toHaveLength(2);
  });

  it("lists vision models and retries a failed stage", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/llm-vision-models")) return jsonResponse({ models: [{ provider: "omniroute", model: "grok-cli/grok-4.7" }] });
      if (url.endsWith("/llm-routing")) return jsonResponse({ tasks: {} });
      expect(url).toContain("/pipeline/stages/VISUAL_SEARCH/retry");
      expect(init?.method).toBe("POST");
      return jsonResponse({ status: "QUEUED" });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const listed = await client.callTool({ name: "list_vision_models", arguments: {} });
    expect(resultText(listed)).toContain("grok-cli/grok-4.7");
    const retried = await client.callTool({
      name: "retry_stage",
      arguments: { projectId, stage: "VISUAL_SEARCH" },
    });
    expect(resultText(retried)).toContain("QUEUED");
  });

  it("set_llm_models posts route assignments", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/api/settings/llm-routing/assign");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        scope: "app",
        assignments: [{ task: "vision", provider: "openai", model: "gpt-4.1" }],
      });
      return jsonResponse({ markedNow: [{ provider: "openai", model: "gpt-4.1" }] });
    }) as typeof fetch;
    const client = await connect(fetchImpl);
    const result = await client.callTool({
      name: "set_llm_models",
      arguments: {
        scope: "app",
        assignments: [{ task: "vision", provider: "openai", model: "gpt-4.1" }],
      },
    });
    expect(resultText(result)).toContain("gpt-4.1");
  });

  it("returns the prompt tools with write instructions", async () => {
    const client = await connect();
    const prompt = await client.getPrompt({ name: "write_story", arguments: { projectId } });
    expect(JSON.stringify(prompt.messages)).toContain("save_story");
    expect(JSON.stringify(prompt.messages)).toContain(projectId);
  });

  it("sends x-api-key from VG_API_KEY", async () => {
    vi.stubEnv("VG_API_KEY", "env-service-key");
    const fetchImpl = vi.fn(async () => jsonResponse({ count: 0, items: [] })) as typeof fetch;
    const client = new VideoAgentApiClient("http://127.0.0.1:3001", fetchImpl);
    await client.listProjects();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/projects?pageSize=20",
      { headers: { Accept: "application/json", "x-api-key": "env-service-key" } },
    );
  });

  it("sends x-api-key from the local secret file when the env key is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-mcp-key-"));
    mkdirSync(join(dir, "secrets"));
    writeFileSync(join(dir, "secrets", "local-services.key"), "file-service-key\n", "utf8");
    vi.stubEnv("VG_API_KEY", "");
    vi.stubEnv("DATA_DIR", dir);
    const fetchImpl = vi.fn(async () => jsonResponse({ count: 0, items: [] })) as typeof fetch;
    const client = new VideoAgentApiClient("http://127.0.0.1:3001", fetchImpl);
    await client.listProjects();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/projects?pageSize=20",
      { headers: { Accept: "application/json", "x-api-key": "file-service-key" } },
    );
  });
});

function resultText(result: { content: { type: string; text?: string }[] }): string {
  const item = result.content.find((entry) => entry.type === "text");
  if (!item?.text) throw new Error("Expected MCP text result");
  return item.text;
}
