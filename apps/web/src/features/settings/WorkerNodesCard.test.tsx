import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerNodesCard } from "./WorkerNodesCard";

afterEach(() => vi.restoreAllMocks());

describe("WorkerNodesCard", () => {
  it("shows how many workers run and links to the Máy page", async () => {
    const node = (id: string, status: string) => ({ id, name: id, status, runningJobs: 0, desiredConfig: { concurrency: 1, drain: false, capabilities: ["render"] } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      settings: { mode: "off", remoteWaitSec: 30 },
      nodes: [node("a", "online"), node("b", "offline")],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><WorkerNodesCard /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText(/Máy worker: 1 đang chạy/)).toBeTruthy());
    expect(screen.getByRole("link", { name: "Mở trang Máy" }).getAttribute("href")).toBe("/nodes");
  });
});
