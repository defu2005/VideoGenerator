import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { DatabaseStatsCard, type DbStats } from "./DatabaseStatsCard";

afterEach(() => vi.unstubAllGlobals());

const mockStats: DbStats = {
  dbSizeBytes: 10485760, // 10 MB
  walSizeBytes: 2097152,  // 2 MB
  busyCount: 3,
  busyRetrySuccessCount: 2,
  busyRetryFailureCount: 1,
  lastCheckpointAt: "2026-11-17T10:00:00.000Z",
  lastCheckpointDurationMs: 42,
  lastCheckpointPages: { checkpointed: 512, total: 512 },
  litestreamActive: true,
  activeBatchQueues: {
    auditQueueLength: 5,
    usageQueueLength: 12,
  },
  metrics: {
    totalStatements: 1250,
    p50Ms: 1.2,
    p95Ms: 4.8,
    maxMs: 25.1,
    slowestStatements: [
      {
        normalizedSql: "SELECT * FROM projects WHERE id = ?",
        count: 100,
        totalMs: 250,
        avgMs: 2.5,
        maxMs: 25.1,
      },
    ],
  },
};

describe("DatabaseStatsCard", () => {
  it("renders database stats and handles checkpoint button", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      if (url.endsWith("/admin/db-stats/checkpoint") && method === "POST") {
        return jsonResponse({
          ok: true,
          pages: { checkpointed: 512, total: 512 },
          durationMs: 35,
        });
      }
      if (url.endsWith("/admin/db-stats")) {
        return jsonResponse(mockStats);
      }
      return jsonResponse({});
    }));

    renderWithProviders(<DatabaseStatsCard />);

    expect(await screen.findByText("10.00 MB")).toBeInTheDocument();
    expect(screen.getByText("WAL: 2.00 MB")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/Thành công: 2 · Thất bại: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Audit: 5 · Usage: 12/)).toBeInTheDocument();
    expect(screen.getByText(/Litestream: Đang bật/)).toBeInTheDocument();
    expect(screen.getByText("SELECT * FROM projects WHERE id = ?")).toBeInTheDocument();

    const checkpointBtn = screen.getByRole("button", { name: "Thu gọn WAL" });
    fireEvent.click(checkpointBtn);

    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/admin/db-stats/checkpoint"))).toBe(true);
    });
  });
});
