import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LLM_TASKS, type ModelAdvisorProposal } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ModelAdvisorPanel } from "./ModelAdvisorPanel";

function proposalFixture(): ModelAdvisorProposal {
  const routes = Object.fromEntries(
    LLM_TASKS.filter((task) => task.id !== "modelAdvisor").map((task) => [
      task.id,
      {
        provider: "mock",
        model: "mock-v1",
        reason: task.id === "script" ? "Model mạnh cho kịch bản." : "Model nhanh.",
      },
    ]),
  ) as ModelAdvisorProposal["routes"];
  return {
    proposalId: "proposal-1",
    scope: "app",
    budgetMode: "BALANCED",
    language: "vi",
    routes,
    notes: "Gợi ý thử nghiệm",
    diff: LLM_TASKS.filter((task) => task.id !== "modelAdvisor").map((task) => ({
      taskId: task.id,
      current: task.id === "script" ? { provider: "mock", model: "old" } : null,
      proposed: routes[task.id]!,
      changed: true,
    })),
    cached: false,
    createdAt: "2026-11-04T00:00:00.000Z",
  };
}

describe("ModelAdvisorPanel", () => {
  it("renders the proposal table and applies selected rows", async () => {
    const proposal = proposalFixture();
    let applied: unknown;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/llm/advisor/propose" && init?.method === "POST") {
        return jsonResponse(proposal);
      }
      if (url === "/api/llm/advisor/apply" && init?.method === "POST") {
        applied = JSON.parse(String(init.body));
        return jsonResponse({
          scope: "app",
          applied: ["script"],
          llm: { tasks: { script: { provider: "mock", model: "mock-v1" } } },
        });
      }
      throw new Error(`Unexpected offline test request: ${url}`);
    }));

    renderWithProviders(<ModelAdvisorPanel scope="app" />);
    fireEvent.click(screen.getByRole("button", { name: "Gợi ý model bằng AI" }));

    expect(await screen.findByText("Gợi ý thử nghiệm")).toBeInTheDocument();
    expect(screen.getByTestId("advisor-row-script")).toBeInTheDocument();
    expect(screen.getByText("Model mạnh cho kịch bản.")).toBeInTheDocument();

    // Keep only script selected
    fireEvent.click(screen.getByLabelText("Chọn tất cả tác vụ"));
    fireEvent.click(screen.getByLabelText("Chọn Viết kịch bản"));
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

    await waitFor(() => expect(applied).toEqual({
      scope: "app",
      proposalId: "proposal-1",
      taskIds: ["script"],
    }));
    expect(await screen.findByText("Đã áp dụng 1 tác vụ.")).toBeInTheDocument();
  });
});
