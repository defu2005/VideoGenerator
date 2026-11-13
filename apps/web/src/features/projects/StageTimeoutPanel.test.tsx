import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { StageTimeoutPanel } from "./StageTimeoutPanel";
import { renderWithProviders } from "../../test/testUtils";

const project = {
  id: "44444444-4444-4444-8444-444444444444",
  settings: {
    stageTimeouts: {
      source: "llm",
      inputHash: "abc",
      summary: "Theo brief.",
      stages: {
        RENDER: { timeoutMs: 420_000, reason: "Video vừa.", source: "llm" },
      },
    },
  },
} as unknown as Project;

describe("StageTimeoutPanel", () => {
  it("shows minutes, the source chip, and posts an override", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ...project,
      settings: {
        stageTimeouts: {
          ...project.settings.stageTimeouts,
          source: "mixed",
          stages: {
            RENDER: { timeoutMs: 480_000, reason: "Bạn chọn.", source: "user" },
          },
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<StageTimeoutPanel project={project} />);
    expect(screen.getByText("AI")).toBeTruthy();
    expect(screen.getByText(/7\.0 phút/)).toBeTruthy();
    fireEvent.blur(screen.getByLabelText("phút Render"), { target: { value: "8" } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ stage: "RENDER", timeoutSec: 480 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/stage-timeouts");
    expect(await screen.findByText("Bạn chọn")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
