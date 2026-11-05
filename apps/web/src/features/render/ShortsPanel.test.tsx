import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ShortsPanel } from "./ShortsPanel";

const projectId = "66666666-6666-4666-8666-666666666666";
const proposalId = "77777777-7777-4777-8777-777777777777";

const view = {
  eligible: true,
  reason: null,
  renderId: "r1",
  options: { count: 3, minSec: 20, maxSec: 45, reframe: "center" as const },
  proposals: [{
    id: proposalId,
    start: 10,
    end: 35,
    hook: "Mở đầu",
    title: "Thiên hà xa",
    reason: "Đoạn rõ",
    score: 80,
    reframe: "center" as const,
    snippet: "Hubble chụp thiên hà.",
    selected: true,
    childProjectId: null,
    jobId: null,
    status: "proposed" as const,
    error: null,
  }],
  children: [],
  jobs: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("ShortsPanel", () => {
  it("renders proposals, sends edits, and creates export jobs", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === "PATCH") {
        return jsonResponse({ ...view, proposals: [{ ...view.proposals[0], title: "Tiêu đề mới", hook: "Hook mới" }] });
      }
      if (init?.method === "POST" && url.endsWith("/export")) {
        return jsonResponse({
          ...view,
          jobs: [{ id: "job-1", proposalId, status: "QUEUED", progress: 0, message: "Đang chờ" }],
          children: [{ id: "88888888-8888-4888-8888-888888888888", title: "Tiêu đề mới", status: "RENDERING", stage: "RENDER" }],
        });
      }
      return jsonResponse(view);
    }));

    renderWithProviders(<ShortsPanel projectId={projectId} renderId="r1" />);
    expect(await screen.findByText("Hubble chụp thiên hà.")).toBeInTheDocument();
    expect(screen.getByLabelText("Xem trước Thiên hà xa")).toHaveAttribute("src", expect.stringContaining("#t=10,35"));

    fireEvent.change(screen.getByLabelText("Hook Thiên hà xa"), { target: { value: "Hook mới" } });
    fireEvent.change(screen.getByLabelText("Tiêu đề Thiên hà xa"), { target: { value: "Tiêu đề mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chỉnh sửa" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH" && String(call.init.body).includes("Tiêu đề mới") && String(call.init.body).includes("Hook mới"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Xuất 1 clip" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "POST" && call.url.endsWith("/export") && String(call.init.body).includes(proposalId))).toBe(true));
    expect(await screen.findByText(/QUEUED/)).toBeInTheDocument();
  });
});
