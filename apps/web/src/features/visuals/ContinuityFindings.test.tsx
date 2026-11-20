import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContinuityReport, ScenePlanSummary } from "@vg/shared";
import { renderWithProviders } from "../../test/testUtils";
import { ContinuityFindings } from "./ContinuityFindings";
import * as apiClient from "../../services/apiClient";
import * as scenesApi from "../../services/scenesApi";

const projectId = "11111111-1111-4111-8111-111111111111";
const sceneId = "22222222-2222-4222-8222-222222222222";

describe("ContinuityFindings", () => {
  it("renders clean state when there are no findings", async () => {
    const report: ContinuityReport = {
      dimension: "continuity",
      findings: [],
      characterCheck: "skipped",
      characterReason: "Không có nhân vật lặp lại cần kiểm tra.",
      estimatedPacing: false,
    };
    vi.spyOn(apiClient, "apiRequest").mockResolvedValue(report);

    renderWithProviders(
      <ContinuityFindings projectId={projectId} revision={1} disabled={false} onResearch={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Không có nhân vật lặp lại cần kiểm tra.")).toBeInTheDocument();
      expect(screen.getByText("Chưa phát hiện lệch màu, nhịp hoặc motif.")).toBeInTheDocument();
    });
  });

  it("renders findings and triggers research on click", async () => {
    const report: ContinuityReport = {
      dimension: "continuity",
      findings: [{
        code: "color_jump",
        sceneIds: [sceneId],
        message: "Màu giữa hai cảnh thay đổi mạnh.",
        suggestedFix: "Đổi sang ứng viên kế tiếp gần bảng màu hơn.",
      }],
      characterCheck: "checked",
      characterReason: "Đã kiểm tra nhân vật bằng một batch vision.",
      estimatedPacing: true,
    };
    vi.spyOn(apiClient, "apiRequest").mockResolvedValue(report);
    const summary: ScenePlanSummary = {
      scenes: [{
        id: sceneId,
        projectId,
        order: 0,
        kind: "section",
        sectionId: null,
        label: "Scene 1",
        narration: "Text",
        visualNotes: "Notes",
        visualDescription: "Desc",
        noVisual: false,
        visualQueries: { primary: "landscape", alternatives: [] },
        queryVariant: false,
        musicMood: "ambient",
        energy: "low",
        estDurationSec: 5,
        durationOverrideSec: null,
        startSec: 0,
        transitionNote: "",
        origin: "AGENT",
        edited: false,
        inputHash: "h1",
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      }],
      totalSec: 5,
      targetSec: 60,
      stale: false,
    };
    vi.spyOn(scenesApi, "getScenes").mockResolvedValue(summary);
    const onResearch = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ContinuityFindings projectId={projectId} revision={1} disabled={false} onResearch={onResearch} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Màu giữa hai cảnh thay đổi mạnh/)).toBeInTheDocument();
      expect(screen.getByText(/Nhịp hiện là ước tính theo cảnh/)).toBeInTheDocument();
    });

    const btn = screen.getByRole("button", { name: "Tìm lại cảnh này" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(onResearch).toHaveBeenCalledWith(sceneId, "landscape");
    });
  });
});
