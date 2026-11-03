import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LLM_TASKS } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AiSettingsPage } from "./AiSettingsPage";

describe("AiSettingsPage", () => {
  it("renders task rows, applies routing presets, resets an override, and saves the task routes", async () => {
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
    vi.stubGlobal("fetch", fetchMock);

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
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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
    }));
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
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/tasks") return jsonResponse(LLM_TASKS);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "claude-cli", label: "Claude CLI", configured: true, defaultModel: null }]);
      if (url === "/api/settings/llm-routing") return jsonResponse({ default: { provider: "claude-cli", model: "claude-sonnet-5-5" } });
      if (url.includes("/models")) return jsonResponse({ provider: "claude-cli", models: all });
      throw new Error(`Unexpected offline test request: ${url}`);
    }));
    renderWithProviders(<AiSettingsPage />);
    await screen.findByRole("heading", { name: "Mô hình AI" });
    const select = await screen.findByRole("combobox", { name: "Model mặc định: chọn từ danh sách" }) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(all.length + 1));
    expect(select.value).toBe("claude-sonnet-5-5");
    fireEvent.change(select, { target: { value: "claude-haiku-4-5" } });
    expect(screen.getByRole("textbox", { name: "Model mặc định" })).toHaveValue("claude-haiku-4-5");
  });
});
