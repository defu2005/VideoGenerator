import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { HermesTab } from "./HermesTab";

afterEach(() => vi.unstubAllGlobals());

const supervisionMock = {
  duty: {
    instance: "hermes/duty-runner",
    expiresAt: "2026-11-13T12:00:00.000Z",
  },
  instances: [
    {
      instance: "hermes/duty-runner",
      kind: "hermes",
      environment: "wsl",
      version: "1.2.0",
      lastSeenAt: "2026-11-13T11:58:00.000Z",
      lastToolAt: "2026-11-13T11:57:00.000Z",
      onDuty: true,
    },
    {
      instance: "hermes/standby-1",
      kind: "hermes",
      environment: "cloud",
      version: "1.2.0",
      lastSeenAt: "2026-11-13T11:56:00.000Z",
      lastToolAt: null,
      onDuty: false,
    },
  ],
  escalations: [
    {
      id: "esc-1",
      fromKind: "operator",
      fromInstance: "app",
      toKind: "hermes" as const,
      kind: "held_quality_gate",
      objectRef: "proj-abc",
      summary: "Kịch bản chưa đạt điểm tối thiểu",
      evidence: { score: 6 },
      status: "open" as const,
      deadlineAt: "2026-11-13T12:30:00.000Z",
      hops: 0,
      claimedBy: null,
      resolvedBy: null,
      outcome: null,
      note: null,
      createdAt: "2026-11-13T11:50:00.000Z",
      updatedAt: "2026-11-13T11:50:00.000Z",
    },
  ],
  actions: [
    {
      id: "act-1",
      tool: "repair_script",
      summary: "Sửa lại mở đầu kịch bản",
      decision: "executed",
      created_at: "2026-11-13T11:55:00.000Z",
      agent_name: "duty-runner",
      agent_model: "qwen-2.5",
    },
  ],
  leases: [
    {
      resourceKind: "project",
      resourceId: "proj-abc",
      holderKind: "hermes",
      holderInstance: "hermes/duty-runner",
      rank: 30,
      acquiredAt: "2026-11-13T11:52:00.000Z",
      expiresAt: "2026-11-13T12:02:00.000Z",
      preemptedBy: null,
    },
  ],
  pause: {
    by: "hermes/duty-runner",
    until: "2026-11-13T12:30:00.000Z",
    reason: "Chờ sửa đồng loạt kịch bản",
    since: "2026-11-13T11:30:00.000Z",
  },
};

describe("HermesTab", () => {
  it("displays duty holder, standby instances, escalations, leases, actions, and pause state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/operator/supervision")) {
          return jsonResponse(supervisionMock);
        }
        return jsonResponse({ ok: true });
      }),
    );

    renderWithProviders(<HermesTab />);

    // Duty & standby instances
    expect((await screen.findAllByText(/hermes\/duty-runner/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/hermes\/standby-1/)).toBeInTheDocument();
    expect(screen.getByText(/Dự phòng \(Standby\)/)).toBeInTheDocument();

    // Pause state
    expect(screen.getByText(/Operator đang tạm dừng bởi:/)).toBeInTheDocument();
    expect(screen.getByText(/Chờ sửa đồng loạt kịch bản/)).toBeInTheDocument();

    // Escalations
    expect(screen.getByText(/Kịch bản chưa đạt điểm tối thiểu/)).toBeInTheDocument();
    expect(screen.getByText(/held_quality_gate/)).toBeInTheDocument();

    // Leases
    expect(screen.getByText(/project:proj-abc/)).toBeInTheDocument();

    // Hermes audit actions
    expect(screen.getByText(/repair_script/)).toBeInTheDocument();
    expect(screen.getByText(/Sửa lại mở đầu kịch bản/)).toBeInTheDocument();
  });
});
