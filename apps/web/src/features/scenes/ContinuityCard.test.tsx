import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyContinuityPlan, type ContinuityEnvelope, type Scene } from "@vg/shared";
import { renderWithProviders } from "../../test/testUtils";
import { ContinuityCard } from "./ContinuityCard";
import * as reviewApi from "../../services/reviewApi";

const projectId = "11111111-1111-4111-8111-111111111111";
const scenes: Scene[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    projectId,
    order: 0,
    kind: "hook",
    sectionId: null,
    label: "Scene 1",
    narration: "Hello world.",
    visualNotes: "A bright river.",
    visualDescription: "River",
    noVisual: false,
    visualQueries: { primary: "river", alternatives: [] },
    queryVariant: false,
    musicMood: "ambient",
    energy: "medium",
    estDurationSec: 5,
    durationOverrideSec: null,
    startSec: 0,
    transitionNote: "",
    origin: "AGENT",
    edited: false,
    inputHash: "h1",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  },
];

describe("ContinuityCard", () => {
  it("renders summary when envelope is present and allows entering edit mode", async () => {
    const plan = emptyContinuityPlan();
    plan.palette.temperature = "warm";
    plan.characters = [{
      id: "alice",
      description: "Alice in red coat",
      appearsInScenes: [scenes[0].id],
      referenceQuery: "alice red coat",
    }];
    plan.motifs = [{
      id: "river",
      description: "Flowing river",
      scenes: [scenes[0].id],
    }];
    const envelope: ContinuityEnvelope = {
      version: 1,
      plan,
      sourceHash: "test",
      weight: 0.05,
    };

    renderWithProviders(<ContinuityCard projectId={projectId} scenes={scenes} envelope={envelope} />);

    expect(screen.getByText("Định hướng hình ảnh")).toBeInTheDocument();
    expect(screen.getByText(/1 nhân vật · 1 motif · Bảng màu ấm/)).toBeInTheDocument();
    expect(screen.getByText(/Alice in red coat · 1 cảnh/)).toBeInTheDocument();

    const editBtn = screen.getByRole("button", { name: "Chỉnh định hướng" });
    fireEvent.click(editBtn);

    expect(screen.getByText("Bảng màu và nhịp")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Alice in red coat")).toBeInTheDocument();
  });

  it("submits PATCH_CONTINUITY_PLAN review proposal on save", async () => {
    const spy = vi.spyOn(reviewApi, "applyRawReviewProposal").mockResolvedValue({} as any);

    renderWithProviders(<ContinuityCard projectId={projectId} scenes={scenes} />);
    expect(screen.getByText(/Chưa có định hướng/)).toBeInTheDocument();

    const editBtn = screen.getByRole("button", { name: "Chỉnh định hướng" });
    fireEvent.click(editBtn);

    const saveBtn = screen.getByRole("button", { name: "Lưu định hướng" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "PATCH_CONTINUITY_PLAN",
          plan: expect.objectContaining({
            palette: expect.any(Object),
            pacing: expect.any(Object),
          }),
        }),
      );
    });
  });
});
