import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { ProjectListPage } from "./ProjectListPage";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const createdAt = "2026-11-02T10:00:00.000Z";
const project: Project = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Ocean documentary",
  topic: "Life under the sea",
  description: "A short video",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "BALANCED" },
    language: "en",
    targetDurationSec: 120,
    aspectRatio: "16:9",
    platform: "youtube",
    style: "storytelling",
    tone: "dramatic",
    audience: "general",
    wordsPerMinute: 150,
    sceneDurationSec: 7,
    visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 },
    music: { enabled: true, volume: 0.15 },
    userSet: [],
    stageExecutors: {},
    autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "DRAFT",
  stage: "TOPIC",
  thumbnailPath: null,
  durationSec: null,
  version: 1,
  createdAt,
  updatedAt: createdAt,
  archivedAt: null,
};

function listResponse(items: Project[]) {
  return { items, total: items.length, page: 1, pageSize: 12 };
}

function usageResponse() {
  const totals = {
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedCalls: 0,
    fallbackCalls: 0,
    failedCalls: 0,
    premiumRequests: 0,
    tokensUnknown: false,
    costUsd: 0,
  };
  return jsonResponse({
    from: null,
    to: null,
    groupBy: "project",
    usdVndRate: 26000,
    totals,
    byGroup: [],
    topProjects: [],
  });
}

describe("ProjectListPage", () => {
  it("renders projects and writes the debounced search into the URL", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).includes("/usage") ? Promise.resolve(usageResponse()) : Promise.resolve(jsonResponse(listResponse([project]))));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ProjectListPage />, ["/projects"]);

    expect(await screen.findByRole("heading", { name: "Ocean documentary" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search projects" }), { target: { value: "ocean" } });
    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent("/projects?q=ocean"), { timeout: 1500 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=ocean"), expect.anything()));
  });

  it("shows the empty state when no project matches", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).includes("/usage") ? Promise.resolve(usageResponse()) : Promise.resolve(jsonResponse(listResponse([])))));
    renderWithProviders(<ProjectListPage />, ["/projects"]);
    expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
  });

  it("retries after an API error", async () => {
    let listRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/usage")) return Promise.resolve(usageResponse());
      listRequests += 1;
      return Promise.resolve(listRequests === 1
        ? jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Temporary failure" } }, 500)
        : jsonResponse(listResponse([project])));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ProjectListPage />, ["/projects"]);

    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary failure");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Ocean documentary" })).toBeInTheDocument();
  });

  it("confirms project deletion and displays a 409 API message", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/usage")) return Promise.resolve(usageResponse());
      if (init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ error: { code: "PROJECT_BUSY", message: "Project is currently running" } }, 409));
      }
      return Promise.resolve(jsonResponse(listResponse([project])));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ProjectListPage />, ["/projects"]);

    await screen.findByRole("heading", { name: "Ocean documentary" });
    fireEvent.click(screen.getByText("•••"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));

    expect(await screen.findByText("Project is currently running")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${project.id}`),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("CreateProjectDialog", () => {
  it("opens as a modal, focuses the topic, and closes on Escape cancellation", () => {
    const onClose = vi.fn();
    renderWithProviders(<CreateProjectDialog open onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByLabelText(/Topic/)).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires a topic and creates with only the topic in quick-create mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input) === "/api/llm/providers" ? jsonResponse([]) : jsonResponse(project, 201));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CreateProjectDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(await screen.findByText("Too small: expected string to have >=1 characters")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: "Lịch sử đại dương" } });
    expect(await screen.findByText(/YouTube · 16:9 · 3 phút · Tiếng Việt · Documentary/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ method: "POST" }),
    ));
    const requestCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/projects");
    const request = requestCall?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ topic: "Lịch sử đại dương" });
  });

  it("sends per-task model settings in the create payload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/llm/providers") {
        return jsonResponse([
          { id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" },
          { id: "openai", label: "OpenAI", configured: true, defaultModel: "gpt-4o" },
        ]);
      }
      if (url.includes("/models")) {
        return jsonResponse({ provider: "mock", models: ["mock-v1", "mock-v2"] });
      }
      if (url === "/api/projects" && init?.method === "POST") {
        return jsonResponse(project, 201);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<CreateProjectDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: "Ocean life" } });
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Advanced settings/ }));
    fireEvent.change(await screen.findByLabelText("AI provider"), { target: { value: "mock" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), { target: { value: "mock-v2" } });
    fireEvent.click(screen.getByText("Mô hình AI theo tác vụ"));
    fireEvent.change(await screen.findByLabelText("Nghiên cứu — nhà cung cấp của dự án"), { target: { value: "openai" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Nghiên cứu — model của dự án" }), { target: { value: "gpt-4o-mini" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ method: "POST" }),
    ));
    const requestCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/projects");
    const body = JSON.parse(String((requestCall?.[1] as RequestInit).body));
    expect(body.settings ?? {}).toMatchObject({
      llm: {
        default: { provider: "mock", model: "mock-v2" },
        tasks: { research: { provider: "openai", model: "gpt-4o-mini" } },
      },
    });
  });

  it("omits the llm key when no project or task model is set", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/llm/providers") return jsonResponse([]);
      if (url === "/api/projects" && init?.method === "POST") return jsonResponse(project, 201);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<CreateProjectDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: "Second project" } });
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ method: "POST" }),
    ));
    const requestCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/projects");
    const body = JSON.parse(String((requestCall?.[1] as RequestInit).body));
    expect(body.settings ?? {}).not.toHaveProperty("llm");
  });

  it("shows recommendations and lets a user reset a customized field", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    renderWithProviders(<CreateProjectDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Topic/), { target: { value: "Ocean life" } });
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    const platform = screen.getByLabelText("Platform");
    expect(platform).toHaveValue("youtube");
    expect(screen.getAllByText("Gợi ý").length).toBeGreaterThan(0);
    fireEvent.change(platform, { target: { value: "tiktok" } });
    expect(screen.getByRole("button", { name: "Reset Platform to recommendation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset Platform to recommendation" }));
    expect(screen.getByLabelText("Platform")).toHaveValue("youtube");
    expect(screen.getAllByText("Gợi ý").length).toBeGreaterThan(0);
  });

  it("previews budget modes live and exposes the CUSTOM feature toggles", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    renderWithProviders(<CreateProjectDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Customize/ }));
    const mode = screen.getByLabelText("Chế độ AI / Budget mode");
    expect(mode).toHaveValue("BALANCED");
    expect(screen.getByText("Ước tính: ~8–14 lượt gọi AI (BALANCED)")).toBeInTheDocument();

    fireEvent.change(mode, { target: { value: "ECO" } });
    expect(screen.getByText("Ước tính: ~1 lượt gọi AI (ECO)")).toBeInTheDocument();
    fireEvent.change(mode, { target: { value: "CUSTOM" } });
    const reviewPasses = screen.getByLabelText("scriptReviewPasses");
    expect(reviewPasses).toHaveValue("1");
    fireEvent.change(reviewPasses, { target: { value: "0" } });
    expect(reviewPasses).toHaveValue("0");
    expect(screen.getByText("Ước tính: ~7–12 lượt gọi AI (CUSTOM)")).toBeInTheDocument();
    fireEvent.change(reviewPasses, { target: { value: "2" } });
    expect(reviewPasses).toHaveValue("2");
    expect(screen.getByText("Ước tính: ~9–16 lượt gọi AI (CUSTOM)")).toBeInTheDocument();
    expect(screen.getByText(/Kiểm tra ảnh bằng AI nhìn \(MAX\/CUSTOM\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("metadata")).toBeInTheDocument();
    expect(screen.getByLabelText("musicAssist")).toBeInTheDocument();
  });
});
