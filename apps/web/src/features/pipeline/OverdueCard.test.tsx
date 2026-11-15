import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverdueJob } from "@vg/shared";
import { renderWithProviders, jsonResponse } from "../../test/testUtils";
import { OverdueCard } from "./OverdueCard";

const projectId = "55555555-5555-4555-8555-555555555555";

function makeOverdueJob(overrides: Partial<OverdueJob> = {}): OverdueJob {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    projectId,
    projectTitle: "Test Project",
    stage: "RENDER",
    attempt: 1,
    state: "checking",
    elapsedMs: 420_000, // 7 min
    expectedMs: 300_000, // 5 min -> overdue by 2 min
    limitMs: 600_000,
    overdueAt: "2026-11-13T00:05:00.000Z",
    nextCheckAt: "2026-11-13T00:07:00.000Z",
    lastAction: null,
    lastReason: null,
    queuedBehind: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OverdueCard", () => {
  it("shows 'quá dự kiến X phút' when elapsed exceeds expected time", async () => {
    const job = makeOverdueJob({ elapsedMs: 420_000, expectedMs: 300_000 });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ job, checks: [] })));

    renderWithProviders(<OverdueCard projectId={projectId} active={true} />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    expect(screen.getByText(/quá dự kiến 2 phút/i)).toBeInTheDocument();
    expect(screen.getByText(/RENDER/i)).toBeInTheDocument();
    expect(screen.getByText("Chờ thêm")).toBeInTheDocument();
  });

  it("shows 'dự kiến còn ~X phút' when running under expected time", async () => {
    const job = makeOverdueJob({ elapsedMs: 120_000, expectedMs: 300_000 });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ job, checks: [] })));

    renderWithProviders(<OverdueCard projectId={projectId} active={true} />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    expect(screen.getByText(/dự kiến còn ~3 phút/i)).toBeInTheDocument();
  });

  it("renders nothing when inactive", () => {
    const { container } = renderWithProviders(<OverdueCard projectId={projectId} active={false} />);
    expect(container.querySelector(".overdue-card")).toBeNull();
  });
});
