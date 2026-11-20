import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ToolProposals } from "./ToolProposals";

// TASK-074c-3c-2c: the accepted list, the draft action and the accept action. fetch is stubbed; no network.
// Fixture shape checked against apps/server/src/operator/toolProposals.ts (listAcceptedToolProposals: open-row shape
// plus impNumber and draftedAt as ISO string or null) and api/operator.ts (accept returns {ok:true}; draft returns
// {status, impNumber} or {status, reason, impNumber}; 500 is INTERNAL_ERROR with the generic message).
// impNumber is assigned at first draft (assignImpNumber), so an accepted row that was never drafted has impNumber null.
afterEach(() => vi.unstubAllGlobals());

const MARKER = "Bản nháp guide — cần Claude xem lại trước khi giao Codex/Cursor";
const openId = "11111111-1111-4111-8111-111111111111";
const draftedId = "22222222-2222-4222-8222-222222222222";
const plainId = "33333333-3333-4333-8333-333333333333";

const base = {
  kind: "internal",
  operation: "op",
  reproduction: "repro",
  impact: "impact",
  inputSchema: {},
  outputSchema: {},
  permissions: ["read"],
  dataSent: "none",
  requiresConfirmation: false,
  acceptance: ["a check"],
};
const openItem = { ...base, id: openId, name: "open_tool" };
const drafted = { ...base, id: draftedId, name: "drafted_tool", impNumber: 7, draftedAt: "2026-11-20T10:00:00.000Z" };
const plain = { ...base, id: plainId, name: "plain_tool", impNumber: null, draftedAt: null };

type Call = { method: string; path: string; body?: string; contentType?: string | null };

// Routes by method and path (the /api prefix removed). Every fetch is recorded so the tests can count them.
function stubApi(handler: (method: string, path: string) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, path, body, contentType: new Headers(init?.headers).get("Content-Type") });
    return handler(method, path);
  }));
  return calls;
}

function openSection(container: HTMLElement) {
  const details = container.querySelector("details");
  if (!details) throw new Error("section details missing");
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

describe("ToolProposals accepted list and actions", () => {
  it("does not fetch either list before the section opens", () => {
    const calls = stubApi(() => jsonResponse({ items: [] }));
    renderWithProviders(<ToolProposals />);
    expect(calls).toHaveLength(0);
  });

  it("lists accepted rows after the section opens and shows the marker only on drafted rows", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [openItem] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [drafted, plain] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await screen.findByText(/drafted_tool/)).toBeTruthy();
    expect(screen.getByText(/plain_tool/)).toBeTruthy();
    expect(screen.getByText(/drafted_tool.*IMP-7/)).toBeTruthy();
    expect(screen.getAllByText(MARKER)).toHaveLength(1);
    expect(screen.getAllByText("Soạn bản nháp")).toHaveLength(1);
  });

  it("drafting a row refreshes both lists and shows the drafted number with the row name", async () => {
    let plainDrafted = false;
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") {
        return jsonResponse({ items: [plainDrafted ? { ...plain, impNumber: 8, draftedAt: "2026-11-20T11:00:00.000Z" } : plain] });
      }
      if (method === "POST" && path === `/operator/tool-proposals/${plainId}/draft`) {
        plainDrafted = true;
        return jsonResponse({ status: "drafted", impNumber: 8 });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    expect(await screen.findByText("Đã soạn bản nháp IMP-8.")).toBeTruthy();
    expect(screen.getByText("Đã soạn bản nháp IMP-8.").closest("p")).toHaveTextContent("plain_tool");
    await waitFor(() => expect(screen.getAllByText(MARKER)).toHaveLength(1));
    // The outcome sits outside the row, so the refetch that removed the draft button does not hide it.
    expect(screen.getByText("Đã soạn bản nháp IMP-8.")).toBeTruthy();
    const openGets = calls.filter((c) => c.method === "GET" && c.path === "/operator/tool-proposals");
    const acceptedGets = calls.filter((c) => c.method === "GET" && c.path.endsWith("/accepted"));
    expect(openGets.length).toBeGreaterThanOrEqual(2);
    expect(acceptedGets.length).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c.method === "POST" && c.path === `/operator/tool-proposals/${plainId}/draft`)).toBe(true);
  });

  it("shows a progress line while the draft runs, then the outcome", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stubApi(async (method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      if (method === "POST") {
        await gate;
        return jsonResponse({ status: "drafted", impNumber: 8 });
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    expect(await screen.findByText(/Đang soạn bản nháp…/)).toBeTruthy();
    release();
    expect(await screen.findByText("Đã soạn bản nháp IMP-8.")).toBeTruthy();
    expect(screen.queryByText(/Đang soạn bản nháp…/)).toBeNull();
  });

  it("shows the pending message for a budget limit, no marker, and refreshes both lists", async () => {
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      if (method === "POST") return jsonResponse({ status: "pending", reason: "budget_limit", impNumber: 8 });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    expect(await screen.findByText("Hết ngân sách soạn bản nháp. Thử lại sau kỳ ngân sách mới.")).toBeTruthy();
    expect(screen.queryByText(MARKER)).toBeNull();
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/accepted")).length).toBeGreaterThanOrEqual(2));
    expect(calls.filter((c) => c.method === "GET" && c.path === "/operator/tool-proposals").length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["bad_name", "Tên đề xuất không hợp lệ để đặt tên file."],
    ["bad_root", "Thư mục docs/proposals không hợp lệ hoặc chưa tồn tại."],
    ["unsafe_target", "Đường dẫn file đích không an toàn, không ghi."],
    ["exists", "File bản nháp cho đề xuất này đã tồn tại."],
    ["bad_content", "Nội dung bản nháp không hợp lệ, không ghi file."],
  ])("shows the refusal message for %s and no marker", async (reason, text) => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      if (method === "POST") return jsonResponse({ status: "refused", reason, impNumber: 8 });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText(MARKER)).toBeNull();
  });

  it.each([
    ["not_accepted", "Đề xuất chưa được chấp nhận nên không soạn được."],
    ["already_drafted", "Đề xuất này đã có bản nháp."],
    ["state_changed", "Trạng thái đề xuất đã đổi. Tải lại danh sách rồi thử."],
    ["in_flight", "Đang soạn bản nháp cho đề xuất này. Thử lại sau."],
  ])("shows the skipped message for %s", async (reason, text) => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      if (method === "POST") return jsonResponse({ status: "skipped", reason });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("shows a generic message for a reason the page does not know", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      if (method === "POST") return jsonResponse({ status: "refused", reason: "mystery", impNumber: 8 });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    expect(await screen.findByText("Không soạn được bản nháp.")).toBeTruthy();
  });

  it("shows the API message in an alert when the draft route is unavailable (503)", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      // In-progress answers cleanly, so the only error on screen is the draft one.
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/done") return jsonResponse({ items: [] });
      return jsonResponse({ error: { code: "OPERATOR_PROPOSAL_DRAFT_UNAVAILABLE", message: "Chưa cấu hình nơi soạn bản nháp." } }, 503);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    // Scoped to the section: MutationToasts (components/ui/Toast.tsx) also pushes a role="alert" error toast
    // with the same message, so an unscoped lookup would still pass if the inline alert were removed.
    expect(await within(container.querySelector("details") as HTMLElement).findByRole("alert")).toHaveTextContent("Chưa cấu hình nơi soạn bản nháp.");
  });

  it("shows the server message in an alert on a generic 500 and refreshes the accepted list", async () => {
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/done") return jsonResponse({ items: [] });
      return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "An internal server error occurred" } }, 500);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Soạn bản nháp"));
    expect(await within(container.querySelector("details") as HTMLElement).findByRole("alert")).toHaveTextContent("An internal server error occurred");
    // A failed draft still refreshes: the runner may have assigned a number before it failed.
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/accepted")).length).toBeGreaterThanOrEqual(2));
  });

  it("accepting an open row posts to accept and refreshes the open and accepted lists", async () => {
    let accepted = false;
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") {
        return jsonResponse({ items: accepted ? [] : [openItem] });
      }
      if (method === "GET" && path === "/operator/tool-proposals/accepted") {
        return jsonResponse({ items: accepted ? [{ ...openItem, impNumber: null, draftedAt: null }] : [] });
      }
      if (method === "POST" && path === `/operator/tool-proposals/${openId}/accept`) {
        accepted = true;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Chấp nhận đề xuất"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/accept"))).toBe(true));
    await waitFor(() => expect(screen.getAllByText("Soạn bản nháp")).toHaveLength(1));
    // Accepted before any draft: no number yet, so no IMP- label.
    expect(screen.queryByText(/IMP-/)).toBeNull();
    const openGets = calls.filter((c) => c.method === "GET" && c.path === "/operator/tool-proposals");
    const acceptedGets = calls.filter((c) => c.method === "GET" && c.path.endsWith("/accepted"));
    expect(openGets.length).toBeGreaterThanOrEqual(2);
    expect(acceptedGets.length).toBeGreaterThanOrEqual(2);
  });

  it("drafted rows have no draft button", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [drafted] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await screen.findByText(/drafted_tool/)).toBeTruthy();
    expect(screen.queryByText("Soạn bản nháp")).toBeNull();
  });

  // TASK-074c-6c: the in-progress button and the in-progress list. Same stub pattern as above.
  it("shows the in-progress button only on drafted accepted rows", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [drafted, plain] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await screen.findByText(/drafted_tool/)).toBeTruthy();
    expect(screen.getAllByText("Đánh dấu đang làm")).toHaveLength(1);
    expect(screen.getAllByText("Soạn bản nháp")).toHaveLength(1);
  });

  it("marking a drafted row in progress posts to start and refreshes the accepted and in-progress lists", async () => {
    let started = false;
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: started ? [] : [drafted] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: started ? [drafted] : [] });
      if (method === "POST" && path === `/operator/tool-proposals/${draftedId}/start`) {
        started = true;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Đánh dấu đang làm"));
    expect(await screen.findByText(/drafted_tool.*IMP-7/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Chưa có đề xuất đã chấp nhận.")).toBeTruthy());
    expect(calls.some((c) => c.method === "POST" && c.path === `/operator/tool-proposals/${draftedId}/start`)).toBe(true);
    expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/accepted")).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/in-progress")).length).toBeGreaterThanOrEqual(2);
  });

  it("shows the server message in an alert on a failed start and still refreshes both lists", async () => {
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [drafted] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/done") return jsonResponse({ items: [] });
      if (method === "POST" && path === `/operator/tool-proposals/${draftedId}/start`) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "An internal server error occurred" } }, 500);
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    fireEvent.click(await screen.findByText("Đánh dấu đang làm"));
    expect(await within(container.querySelector("details") as HTMLElement).findByRole("alert")).toHaveTextContent("An internal server error occurred");
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/accepted")).length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/in-progress")).length).toBeGreaterThanOrEqual(2));
  });

  it("lists in-progress rows with their number and marker, and has no in-progress button on them", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await screen.findByText(/drafted_tool.*IMP-7/)).toBeTruthy();
    expect(screen.getAllByText(MARKER)).toHaveLength(1);
    expect(screen.queryByText("Đánh dấu đang làm")).toBeNull();
  });

  it("shows an empty message for the in-progress list when no row is in progress", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await screen.findByText("Chưa có đề xuất đang làm.")).toBeTruthy();
  });
});

// TASK-074c-6f: the check-done controls in the in-progress section. POST /:id/check-done with {task}; 409 and 400 come
// back as coded errors (apps/server/src/api/operator.ts). The server is the authority on the task name format.
const secondId = "44444444-4444-4444-8444-444444444444";
const secondInProgress = { ...base, id: secondId, name: "second_tool", impNumber: 8, draftedAt: "2026-11-20T11:00:00.000Z" };
const checkDoneUrl = (id: string) => `/operator/tool-proposals/${id}/check-done`;
const checkInput = (name: string) => screen.getByRole("textbox", { name: `Tên task cho ${name}` });
const checkButtons = () => screen.queryAllByText("Kiểm tra đã xong");

describe("TASK-074c-6f: check-done controls in the in-progress section", () => {
  it("shows the input and button only on in-progress rows, not on accepted rows", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await screen.findByText(/drafted_tool.*IMP-7/)).toBeTruthy();
    expect(checkInput("drafted_tool")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(checkButtons()).toHaveLength(1);
  });

  it("disables the button for an empty or whitespace-only input and enables it after a name is typed", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/drafted_tool.*IMP-7/);
    const button = () => screen.getByRole("button", { name: "Kiểm tra đã xong" }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "   " } });
    expect(button().disabled).toBe(true);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-X" } });
    expect(button().disabled).toBe(false);
  });

  it("posts the trimmed task as exactly {task} as JSON to the row's check-done route", async () => {
    let done = false;
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: done ? [] : [drafted] });
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        done = true;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/drafted_tool.*IMP-7/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "  TASK-X  " } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra đã xong" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === checkDoneUrl(draftedId))).toBe(true));
    const post = calls.find((c) => c.method === "POST" && c.path === checkDoneUrl(draftedId));
    expect(post?.body).toBe(JSON.stringify({ task: "TASK-X" }));
    expect(post?.contentType).toBe("application/json");
  });

  it("on success refetches the in-progress list and names the proposal and task in an outcome line", async () => {
    let done = false;
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: done ? [] : [drafted] });
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        done = true;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/drafted_tool.*IMP-7/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-X" } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra đã xong" }));
    expect(await screen.findByText("Đã đánh dấu xong: drafted_tool (task TASK-X)")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Chưa có đề xuất đang làm.")).toBeTruthy());
    expect(screen.getByText("Đã đánh dấu xong: drafted_tool (task TASK-X)")).toBeTruthy();
    expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/in-progress")).length).toBeGreaterThanOrEqual(2);
  });

  it("on a 409 shows the message in the section alert, keeps the row and the typed value, and refetches", async () => {
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted] });
      if (method === "GET" && path === "/operator/tool-proposals/done") return jsonResponse({ items: [] });
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        return jsonResponse({ error: { code: "OPERATOR_TASK_NOT_DONE", message: "Chưa có file .done cho task này." } }, 409);
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/drafted_tool.*IMP-7/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-X" } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra đã xong" }));
    expect(await within(container.querySelector("details") as HTMLElement).findByRole("alert")).toHaveTextContent("Chưa có file .done cho task này.");
    expect(checkInput("drafted_tool")).toHaveValue("TASK-X");
    expect(screen.getByText(/drafted_tool.*IMP-7/)).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/in-progress")).length).toBeGreaterThanOrEqual(2));
  });

  it("on a 400 shows the message in the section alert, keeps the row and the typed value, and refetches", async () => {
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted] });
      if (method === "GET" && path === "/operator/tool-proposals/done") return jsonResponse({ items: [] });
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Request validation failed" } }, 400);
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/drafted_tool.*IMP-7/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "../bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra đã xong" }));
    expect(await within(container.querySelector("details") as HTMLElement).findByRole("alert")).toHaveTextContent("Request validation failed");
    expect(checkInput("drafted_tool")).toHaveValue("../bad");
    expect(screen.getByText(/drafted_tool.*IMP-7/)).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path.endsWith("/in-progress")).length).toBeGreaterThanOrEqual(2));
  });

  it("keeps each row's typed value separate and posts to the id of the row whose button was clicked", async () => {
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted, secondInProgress] });
      if (method === "POST") return jsonResponse({ ok: true });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/second_tool.*IMP-8/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-A" } });
    fireEvent.change(checkInput("second_tool"), { target: { value: "TASK-B" } });
    expect(checkInput("drafted_tool")).toHaveValue("TASK-A");
    expect(checkInput("second_tool")).toHaveValue("TASK-B");
    const buttons = screen.getAllByRole("button", { name: "Kiểm tra đã xong" });
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === checkDoneUrl(secondId))).toBe(true));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe(checkDoneUrl(secondId));
    expect(post?.body).toBe(JSON.stringify({ task: "TASK-B" }));
    expect(calls.some((c) => c.method === "POST" && c.path === checkDoneUrl(draftedId))).toBe(false);
  });

  it("disables every check-done button while one request is in flight, then settles", async () => {
    let release: () => void = () => {};
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted, secondInProgress] });
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        return new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse({ ok: true }));
        });
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/second_tool.*IMP-8/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-X" } });
    fireEvent.change(checkInput("second_tool"), { target: { value: "TASK-B" } });
    const buttons = () => screen.getAllByRole("button", { name: "Kiểm tra đã xong" }) as HTMLButtonElement[];
    fireEvent.click(buttons()[0]);
    await waitFor(() => expect(buttons().every((b) => b.disabled)).toBe(true));
    release();
    await waitFor(() => expect(screen.getByText("Đã đánh dấu xong: drafted_tool (task TASK-X)")).toBeTruthy());
  });
});

// TASK-074c-6h: the read-only "Đã xong" section. GET /operator/tool-proposals/done lists done tool rows with taskRef.
// No button and no mutation here. The query shares the list prefix, so check-done's refresh also updates it.
const doneUrl = "/operator/tool-proposals/done";
const doneA = { ...base, id: "55555555-5555-4555-8555-555555555555", name: "done_a", impNumber: 7, draftedAt: "2026-11-20T10:00:00.000Z", taskRef: "TASK-A" };
// done_b is the realistic legacy row: a draft assigned IMP-8, and no task was ever recorded.
const doneB = { ...base, id: "66666666-6666-4666-8666-666666666666", name: "done_b", impNumber: 8, draftedAt: "2026-11-20T11:00:00.000Z", taskRef: null };
// The section is a labelled region, so row queries never reach the open, accepted or in-progress rows.
const doneRegion = () => screen.getByRole("region", { name: "Đã xong" });
const doneSummaries = () => [...doneRegion().querySelectorAll("summary")].map((s) => s.textContent ?? "");

describe("TASK-074c-6h: read-only done section", () => {
  it("does not fetch the done list before the section opens", () => {
    const calls = stubApi(() => jsonResponse({ items: [] }));
    renderWithProviders(<ToolProposals />);
    expect(calls.some((c) => c.path === doneUrl)).toBe(false);
  });

  it("lists done rows in server order, with the IMP number and the task name in the summary", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: [doneA, doneB] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/done_a.*IMP-7.*TASK-A/);
    expect(doneSummaries()).toEqual([
      "done_a · Tool nội bộ · IMP-7 · TASK-A",
      "done_b · Tool nội bộ · IMP-8",
    ]);
  });

  it("shows only the task name for a done row with a task and no IMP number", async () => {
    // 6h limit 6: taskRef without IMP. doneLabel must drop the missing IMP part, not print "null" or "IMP-".
    const doneC = { ...base, id: "77777777-7777-4777-8777-777777777777", name: "done_c", impNumber: null, draftedAt: "2026-11-20T12:00:00.000Z", taskRef: "TASK-C" };
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: [doneC] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/done_c.*TASK-C/);
    expect(doneSummaries()).toEqual(["done_c · Tool nội bộ · TASK-C"]);
  });

  it("shows an empty message when no row is done", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: [] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await within(doneRegion()).findByText("Chưa có đề xuất đã xong.")).toBeTruthy();
  });

  it("shows a loading message while the done list loads", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) return new Promise<Response>(() => {});
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await within(doneRegion()).findByText("Đang tải đề xuất đã xong…")).toBeTruthy();
  });

  it("has no input, button or draft or start control on done rows", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: [doneA] });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/done_a.*IMP-7.*TASK-A/);
    const region = within(doneRegion());
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    expect(region.queryAllByRole("button")).toHaveLength(0);
    expect(region.queryAllByText("Kiểm tra đã xong")).toHaveLength(0);
    expect(region.queryAllByText("Đánh dấu đang làm")).toHaveLength(0);
    expect(region.queryAllByText("Soạn bản nháp")).toHaveLength(0);
  });

  it("shows a done-list error in the section alert", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Không đọc được danh sách đã xong." } }, 500);
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    expect(await within(container.querySelector("details") as HTMLElement).findByRole("alert")).toHaveTextContent("Không đọc được danh sách đã xong.");
  });

  it("when the done list and a check-done both fail, the alert shows the check-done error", async () => {
    let checked = false;
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted] });
      if (method === "GET" && path === doneUrl) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Không đọc được danh sách đã xong." } }, 500);
      }
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        checked = true;
        return jsonResponse({ error: { code: "OPERATOR_TASK_NOT_DONE", message: "Task chưa xong." } }, 409);
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/drafted_tool.*IMP-7/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-X" } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra đã xong" }));
    await waitFor(() => expect(checked).toBe(true));
    // actionError ranks above the done-list error in the alert chain, so the check-done error wins over it.
    // The done-list error is already on screen, so retry until the check-done text replaces it.
    await waitFor(() => expect(within(container.querySelector("details") as HTMLElement).getByRole("alert")).toHaveTextContent("Task chưa xong."));
    expect(calls.some((c) => c.method === "GET" && c.path === doneUrl)).toBe(true);
  });

  it("after a successful check-done the done list is refetched and shows the row with its task", async () => {
    let checked = false;
    const doneAfter = { ...drafted, taskRef: "TASK-X" };
    const calls = stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: checked ? [] : [drafted] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: checked ? [doneAfter] : [] });
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        checked = true;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    await screen.findByText(/drafted_tool.*IMP-7/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-X" } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra đã xong" }));
    expect(await screen.findByText(/drafted_tool · Tool nội bộ · IMP-7 · TASK-X/)).toBeTruthy();
    expect(doneSummaries()).toEqual(["drafted_tool · Tool nội bộ · IMP-7 · TASK-X"]);
    expect(calls.filter((c) => c.method === "GET" && c.path === doneUrl).length).toBeGreaterThanOrEqual(2);
  });
});

// TASK-074c-6f: one slot for action errors. Each action clears the slot when it starts and sets it when it fails, so an
// older error never hides a newer one. Lookups are scoped to the section because MutationToasts also renders role="alert".
describe("TASK-074c-6f: one alert slot for action errors", () => {
  it("a failed dismiss does not hide a later check-done error in the section alert", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [openItem] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [drafted] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: [] });
      if (method === "POST" && path === `/operator/tool-proposals/${openId}/dismiss`) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Không bỏ qua được đề xuất." } }, 500);
      }
      if (method === "POST" && path === checkDoneUrl(draftedId)) {
        return jsonResponse({ error: { code: "OPERATOR_TASK_NOT_DONE", message: "Task chưa xong." } }, 409);
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    const section = () => within(container.querySelector("details") as HTMLElement);
    fireEvent.click(await section().findByRole("button", { name: "Bỏ qua đề xuất" }));
    expect(await section().findByRole("alert")).toHaveTextContent("Không bỏ qua được đề xuất.");
    await screen.findByText(/drafted_tool.*IMP-7/);
    fireEvent.change(checkInput("drafted_tool"), { target: { value: "TASK-X" } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra đã xong" }));
    await waitFor(() => expect(section().getByRole("alert")).toHaveTextContent("Task chưa xong."));
  });

  it("a failed draft is cleared when a later start succeeds, so the section alert no longer shows the draft error", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [plain, drafted] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: [] });
      if (method === "POST" && path === `/operator/tool-proposals/${plainId}/draft`) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Soạn bản nháp lỗi." } }, 500);
      }
      if (method === "POST" && path === `/operator/tool-proposals/${draftedId}/start`) return jsonResponse({ ok: true });
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    const section = () => within(container.querySelector("details") as HTMLElement);
    fireEvent.click(await section().findByRole("button", { name: "Soạn bản nháp" }));
    expect(await section().findByRole("alert")).toHaveTextContent("Soạn bản nháp lỗi.");
    fireEvent.click(await section().findByRole("button", { name: "Đánh dấu đang làm" }));
    await waitFor(() => expect(section().queryByRole("alert")).toBeNull());
  });

  it("a failed accept shows its message in the section alert", async () => {
    stubApi((method, path) => {
      if (method === "GET" && path === "/operator/tool-proposals") return jsonResponse({ items: [openItem] });
      if (method === "GET" && path === "/operator/tool-proposals/accepted") return jsonResponse({ items: [] });
      if (method === "GET" && path === "/operator/tool-proposals/in-progress") return jsonResponse({ items: [] });
      if (method === "GET" && path === doneUrl) return jsonResponse({ items: [] });
      if (method === "POST" && path === `/operator/tool-proposals/${openId}/accept`) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Không chấp nhận được đề xuất." } }, 500);
      }
      return jsonResponse({}, 404);
    });
    const { container } = renderWithProviders(<ToolProposals />);
    openSection(container);
    const section = () => within(container.querySelector("details") as HTMLElement);
    fireEvent.click(await section().findByRole("button", { name: "Chấp nhận đề xuất" }));
    expect(await section().findByRole("alert")).toHaveTextContent("Không chấp nhận được đề xuất.");
  });
});
