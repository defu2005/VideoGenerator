import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LLM_TASKS } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AiSettingsPage } from "./AiSettingsPage";

function stubGatewayApis(
  fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  overrides: Record<string, unknown> = {},
) {
  const health = overrides.health ?? {
    reachable: false,
    latencyMs: null,
    modelCount: 0,
    lastError: "fetch failed",
    baseUrl: "http://127.0.0.1:20128/v1",
    configured: false,
    setupHint: "Cài OmniRoute rồi đặt OMNIROUTE_API_KEY",
  };
  const gateway = overrides.gateway ?? { mode: "off", mappings: [] };
  const catalog = overrides.catalog ?? { models: [], cachedAt: null, baseUrl: "http://127.0.0.1:20128/v1" };
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/settings/llm-gateway" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as unknown;
      (overrides as { savedGateway?: unknown }).savedGateway = body;
      return jsonResponse(body);
    }
    if (url === "/api/settings/llm-gateway") return jsonResponse(gateway);
    if (url === "/api/llm/providers/omniroute/health") return jsonResponse(health);
    if (url === "/api/llm/providers/omniroute/catalog/refresh") return jsonResponse(catalog);
    if (url === "/api/llm/providers/omniroute/catalog") return jsonResponse(catalog);
    return fetchMock(input, init);
  };
}

describe("AiSettingsPage", () => {
  it("renders task rows, applies routing presets, resets an override, and saves the task routes", { timeout: 15_000 }, async () => {
    let saved: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") {
        return jsonResponse([
          { id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" },
          { id: "copilot-cli", label: "Copilot CLI", configured: false, defaultModel: null, hint: "Sign in first" },
        ]);
      }
      if (url === "/api/settings/llm-routing" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body)) as unknown;
        return jsonResponse(saved);
      }
      if (url === "/api/settings/llm-routing") return jsonResponse({ tasks: { research: { provider: "mock", model: "old-model" } } });
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: ["mock-v1"] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(fetchMock));

    renderWithProviders(<AiSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Mô hình AI" })).toBeInTheDocument();
    expect(screen.getByText("Nghiên cứu")).toBeInTheDocument();
    expect(screen.getByText("Mô tả hình + từ khóa theo scene")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nhà cung cấp model mạnh"), { target: { value: "mock" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model mạnh" }), { target: { value: "strong-model" } });
    fireEvent.change(screen.getByLabelText("Nhà cung cấp model nhanh"), { target: { value: "mock" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model nhanh" }), { target: { value: "fast-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Một model cho tất cả" }));
    fireEvent.click(screen.getByRole("button", { name: "Mạnh cho viết, nhanh cho việc phụ" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Dùng mặc định" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));

    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({
      default: { provider: "mock", model: "strong-model" },
      tasks: {
        script: { provider: "mock", model: "strong-model" },
        sceneQueries: { provider: "mock", model: "fast-model" },
      },
    });
    expect((saved as { tasks: Record<string, unknown> }).tasks).not.toHaveProperty("research");
  });

  it("lays tasks out as cards with stage and tier chips and lists unconfigured providers as disabled", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") {
        return jsonResponse([
          { id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" },
          { id: "anthropic", label: "Anthropic API", configured: false, defaultModel: null, hint: "Set ANTHROPIC_API_KEY" },
        ]);
      }
      if (url === "/api/settings/llm-routing") return jsonResponse({});
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: [] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(inner));
    const { container } = renderWithProviders(<AiSettingsPage />);
    await screen.findByRole("heading", { name: "Mô hình AI" });
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelectorAll(".ai-task-card")).toHaveLength(LLM_TASKS.length);
    expect(container.querySelectorAll(".ai-task-card .ai-chip-strong").length).toBeGreaterThan(0);
    const option = screen.getByLabelText("Nghiên cứu — nhà cung cấp").querySelector('option[value="anthropic"]') as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain("chưa cấu hình");
  });

  it("shows every model of the chosen provider in a dropdown, not filtered by the typed text", async () => {
    const all = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-4-5"];
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "claude-cli", label: "Claude CLI", configured: true, defaultModel: null }]);
      if (url === "/api/settings/llm-routing") return jsonResponse({ default: { provider: "claude-cli", model: "claude-sonnet-5-5" } });
      if (url.includes("/models")) return jsonResponse({ provider: "claude-cli", models: all });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(inner));
    renderWithProviders(<AiSettingsPage />);
    await screen.findByRole("heading", { name: "Mô hình AI" });
    const select = await screen.findByRole("combobox", { name: "Model mặc định: chọn từ danh sách" }) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(all.length + 1));
    expect(select.value).toBe("claude-sonnet-5-5");
    fireEvent.change(select, { target: { value: "claude-haiku-4-5" } });
    expect(screen.getByRole("textbox", { name: "Model mặc định" })).toHaveValue("claude-haiku-4-5");
  });

  it("renders the OmniRoute gateway status and saves the mode", async () => {
    const overrides: { savedGateway?: unknown; health?: unknown; gateway?: unknown; catalog?: unknown } = {
      health: {
        reachable: true,
        latencyMs: 12,
        modelCount: 2,
        lastError: null,
        baseUrl: "http://127.0.0.1:20128/v1",
        configured: true,
        setupHint: "hint",
      },
      gateway: { mode: "off", mappings: [] },
      catalog: {
        models: [{ id: "cc/claude-sonnet", ownedBy: "anthropic" }],
        cachedAt: "2026-11-04T00:00:00.000Z",
        baseUrl: "http://127.0.0.1:20128/v1",
      },
    };
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" }]);
      if (url === "/api/settings/llm-routing") return jsonResponse({});
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: ["mock-v1"] });
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", stubGatewayApis(inner, overrides));

    renderWithProviders(<AiSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Gateway OmniRoute" })).toBeInTheDocument();
    expect(screen.getByText("Đang chạy")).toBeInTheDocument();
    expect(document.querySelector(".ai-gateway-dot-up")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Chế độ gateway OmniRoute"), { target: { value: "prefer" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu gateway" }));

    await waitFor(() => expect(overrides.savedGateway).toEqual({ mode: "prefer", mappings: [] }));
    expect(await screen.findByText("Đã lưu cài đặt gateway.")).toBeInTheDocument();
  });
});
