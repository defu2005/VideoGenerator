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
});
