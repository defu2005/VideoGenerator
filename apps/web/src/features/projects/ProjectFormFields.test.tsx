import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { DEFAULT_PROJECT_DRAFT, ProjectFormFields } from "./ProjectFormFields";

describe("ProjectFormFields task routes", () => {
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
});
