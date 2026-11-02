import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

describe("DashboardPage", () => {
  it("renders the live counts and navigates to a selected status filter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      total: 9,
      byStatus: {
        DRAFT: 2,
        GENERATING: 1,
        REVIEW: 3,
        RENDERING: 1,
        COMPLETED: 1,
        FAILED: 1,
      },
      archived: 4,
      recent: [],
      recentErrors: [],
    })));
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("button", { name: /Review/ })).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: /Draft/ }));
    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent("/projects?status=DRAFT"));
  });

  it("links recent job errors to the affected project", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      total: 1,
      byStatus: {
        DRAFT: 0,
        GENERATING: 0,
        REVIEW: 0,
        RENDERING: 0,
        COMPLETED: 0,
        FAILED: 1,
      },
      archived: 0,
      recent: [],
      recentErrors: [{
        jobId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        projectTitle: "Ocean project",
        stage: "SCRIPT",
        code: "STAGE_FAILURE",
        message: "Script stage failed",
        at: "2026-11-03T00:00:00.000Z",
      }],
    })));
    renderWithProviders(<DashboardPage />);
    const projectLink = await screen.findByRole("link", { name: "Ocean project" });
    expect(projectLink).toHaveAttribute("href", "/projects/55555555-5555-4555-8555-555555555555/overview");
    expect(screen.getByText("Script stage failed")).toBeInTheDocument();
  });
});
