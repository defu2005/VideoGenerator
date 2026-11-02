import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import type { Project } from "@vg/shared";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const project: Project = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Ocean documentary",
  topic: "Life under the sea",
  description: "A short video",
  mode: "ASSISTED",
  settings: { language: "en", targetDurationSec: 120, aspectRatio: "16:9", stageExecutors: {}, autoRender: false },
  status: "REVIEW",
  stage: "VISUAL_REVIEW",
  thumbnailPath: null,
  durationSec: null,
  version: 2,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  archivedAt: null,
};

function renderDetail(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/:tab" element={<ProjectDetailPage />} />
    </Routes>,
    [path],
  );
}

describe("ProjectDetailPage", () => {
  it("shows project header and redirects unknown tabs to overview", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(project)));
    renderDetail(`/projects/${project.id}/unknown`);
    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent(`/projects/${project.id}/overview`));
  });

  it("renders project data for the overview tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(project)));
    renderDetail(`/projects/${project.id}/overview`);
    expect(await screen.findByRole("heading", { name: "Ocean documentary" })).toBeInTheDocument();
    expect(screen.getAllByText("VISUAL REVIEW")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Production stages" })).toBeInTheDocument();
  });

  it("shows a back link when the API returns 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    }, 404)));
    renderDetail(`/projects/${project.id}/overview`);
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to project library" })).toHaveAttribute("href", "/projects");
  });
});
