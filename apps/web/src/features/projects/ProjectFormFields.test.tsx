import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { DEFAULT_PROJECT_DRAFT, ProjectFormFields, settingsFromDraft } from "./ProjectFormFields";

describe("ProjectFormFields task routes", () => {
  it("loads language-matched voices and includes voice settings in the saved project settings", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/providers") return jsonResponse([]);
      if (url === "/api/tts/voices") return jsonResponse({ voices: [
        { language: "vi-VN", gender: "female", name: "vi-VN-HoaiMyNeural" },
        { language: "en-US", gender: "female", name: "en-US-AriaNeural" },
      ] });
      throw new Error(`Unexpected offline test request: ${url}`);
    }));
    const onChange = vi.fn();
    renderWithProviders(<ProjectFormFields
      draft={{ ...DEFAULT_PROJECT_DRAFT, language: "vi" }}
      errors={{}}
      onChange={onChange}
      advanced
      onToggleAdvanced={() => undefined}
    />);
    const voice = await screen.findByRole("combobox", { name: "Giọng đọc" });
    expect(await screen.findByRole("option", { name: "vi-VN-HoaiMyNeural" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "en-US-AriaNeural" })).not.toBeInTheDocument();
    fireEvent.change(voice, { target: { value: "vi-VN-HoaiMyNeural" } });
    expect(onChange).toHaveBeenLastCalledWith("voice", "vi-VN-HoaiMyNeural");
    expect(settingsFromDraft({ ...DEFAULT_PROJECT_DRAFT, voice: "vi-VN-HoaiMyNeural", rate: "+10%" })).toMatchObject({
      voice: { voice: "vi-VN-HoaiMyNeural", rate: "+10%" },
    });
  });

  it("shows multilingual voices in the multilingual voice group", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/providers") return jsonResponse([]);
      if (url === "/api/tts/voices") return jsonResponse({ voices: [
        { language: "en-US", gender: "female", name: "en-US-EmmaMultilingualNeural", multilingual: true },
      ] });
      throw new Error(`Unexpected offline test request: ${url}`);
    }));
    renderWithProviders(<ProjectFormFields
      draft={{ ...DEFAULT_PROJECT_DRAFT, language: "vi" }}
      errors={{}}
      onChange={() => undefined}
      advanced
      onToggleAdvanced={() => undefined}
    />);

    const voice = await screen.findByRole("combobox", { name: "Giọng đọc" });

    expect(await screen.findByRole("group", { name: "Giọng đa ngôn ngữ" })).toContainElement(
      await screen.findByRole("option", { name: "en-US-EmmaMultilingualNeural" }),
    );
    expect(voice).toBeInTheDocument();
  });

  it("shows effective route source badges and lets a project override one task", async () => {
    const onLlmTasksChange = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/providers") {
        return jsonResponse([{ id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" }]);
      }
      if (url.endsWith("/llm-routes")) {
        return jsonResponse({
          routes: {
            research: { provider: "mock", model: "app-model", source: "app-task" },
            script: { provider: "mock", model: "project-model", source: "project-default" },
            metadata: { provider: "mock", model: "env-model", source: "env-default" },
          },
        });
      }
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ProjectFormFields
      draft={DEFAULT_PROJECT_DRAFT}
      errors={{}}
      onChange={() => undefined}
      advanced
      onToggleAdvanced={() => undefined}
      projectId="11111111-1111-4111-8111-111111111111"
      llmTasks={{ script: { provider: "mock", model: "project-script" } }}
      onLlmTasksChange={onLlmTasksChange}
    />);

    fireEvent.click(screen.getByText("Mô hình AI theo tác vụ"));
    expect(await screen.findByText(/RESEARCH · Mặc định app/)).toBeInTheDocument();
    expect(screen.getByText(/SCRIPT · Dự án/)).toBeInTheDocument();
    expect(screen.getByText(/FINAL · ENV/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nghiên cứu — nhà cung cấp của dự án"), { target: { value: "mock" } });
    await waitFor(() => expect(onLlmTasksChange).toHaveBeenLastCalledWith({
      script: { provider: "mock", model: "project-script" },
      research: { provider: "mock" },
    }));
  });

  it("shows provider models and keeps the model field disabled until a provider is selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      throw new Error(`Unexpected offline test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    const withoutProvider = renderWithProviders(<ProjectFormFields
      draft={{ ...DEFAULT_PROJECT_DRAFT, llmProvider: "" }}
      errors={{}}
      onChange={onChange}
      advanced
      onToggleAdvanced={() => undefined}
    />);
    const disabledSelect = await screen.findByRole("combobox", { name: "Model: chọn từ danh sách" });
    expect(disabledSelect).toBeDisabled();
    expect(screen.getByText("Chọn nhà cung cấp trước để xem danh sách model")).toBeInTheDocument();
    withoutProvider.unmount();

    renderWithProviders(<ProjectFormFields
      draft={{ ...DEFAULT_PROJECT_DRAFT, llmProvider: "mock" }}
      errors={{}}
      onChange={onChange}
      advanced
      onToggleAdvanced={() => undefined}
    />);
    const modelSelect = await screen.findByRole("combobox", { name: "Model: chọn từ danh sách" });
    expect(modelSelect).not.toBeDisabled();
    await waitFor(() => expect(screen.getByRole("option", { name: "mock-v2" })).toBeInTheDocument());

    fireEvent.change(modelSelect, { target: { value: "mock-v2" } });
    expect(onChange).toHaveBeenLastCalledWith("llmModel", "mock-v2");
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), { target: { value: "custom-model" } });
    expect(onChange).toHaveBeenLastCalledWith("llmModel", "custom-model");
  });

  it("keeps a saved custom model that is not in the provider list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/llm/providers") return jsonResponse([{ id: "mock", label: "Mock", configured: true, defaultModel: "mock-v1" }]);
      if (url.includes("/models")) return jsonResponse({ provider: "mock", models: ["mock-v1"] });
      throw new Error(`Unexpected offline test request: ${url}`);
    }));
    const onChange = vi.fn();
    renderWithProviders(<ProjectFormFields
      draft={{ ...DEFAULT_PROJECT_DRAFT, llmProvider: "mock", llmModel: "my-custom" }}
      errors={{}}
      onChange={onChange}
      advanced
      onToggleAdvanced={() => undefined}
    />);
    await waitFor(() => expect(screen.getByRole("option", { name: "mock-v1" })).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalledWith("llmModel", "");
  });
});
