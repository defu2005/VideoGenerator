import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { JobSchema } from "@vg/shared";
import { AgentStageCard } from "./AgentStageCard";
import { pipelineKeys } from "../../hooks/usePipeline";

vi.mock("../../hooks/useCan", () => ({ useCan: () => true }));
afterEach(() => vi.unstubAllGlobals());
it("shows the holder, handoff reason and heartbeat, then takes back through the fenced API", async () => {
  const job = JobSchema.parse({ id: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222", stage: "VISUAL_SEARCH", scope: null, executor: "agent", status: "RUNNING", progress: 42, attempt: 1, maxAttempts: 3, error: null, usage: null, createdAt: "2026-11-15T01:00:00Z", runAfter: "2026-11-15T01:00:00Z", startedAt: "2026-11-15T01:01:00Z", finishedAt: null, message: "Đang tìm ảnh", agentInstance: "hermes/Hermes-2", handoffReason: "Hết quota Brave", heartbeatAt: new Date().toISOString() });
  const fetch = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><AgentStageCard projectId={job.projectId} job={job} /></QueryClientProvider>);
  expect(screen.getByText(/Agent hermes\/Hermes-2 đang xử lý/)).toBeInTheDocument();
  expect(screen.getByText("Lý do: Hết quota Brave")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Heartbeat:");
  fireEvent.click(screen.getByRole("button", { name: "Lấy lại cho app" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/stage-agents/jobs/${job.id}/take-back`, expect.objectContaining({ method: "POST" })));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: pipelineKeys.detail(job.projectId) }));
});
