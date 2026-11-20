import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, jsonResponse } from "../../test/testUtils";
import { FleetThreads } from "./FleetThreads";

// TASK-129a step 6 (UI): thread list, literal bodies, reply target, returned kind, 8 KB guard.
afterEach(() => vi.unstubAllGlobals());

const T = "2026-11-18T08:00:00.000Z";
const message = (over: Record<string, unknown>) => ({ id: "m0", fromInstance: "hermes/wsl", toKind: "duty", toValue: "duty", kind: "report", body: "", createdAt: T, ackedAt: null, ...over });

function stubFetch(posted: { body?: unknown; response?: unknown } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/operator/fleet/threads") && (!init || !init.method)) {
      return jsonResponse({ threads: [{ threadId: "t1", messages: 2, lastAt: T, lastFrom: "hermes/wsl", lastKind: "report", projectId: null }] });
    }
    if (url.includes("/operator/fleet/threads/t1/messages") && init?.method === "POST") {
      posted.body = JSON.parse(String(init.body));
      return jsonResponse({ message: posted.response ?? { kind: "directive" } }, 201);
    }
    if (url.includes("/operator/fleet/threads/t1")) {
      return jsonResponse({ messages: [
        message({ id: "m1", fromInstance: "hermes/wsl", body: "<b>x</b> & báo cáo" }),
        message({ id: "m2", fromInstance: "user", toKind: "instance", toValue: "hermes/wsl", kind: "directive", body: "đã nhận" }),
      ] });
    }
    return jsonResponse({ error: "không khớp" }, 404);
  }));
}

it("lists threads and shows bodies as literal text, not markup", async () => {
  stubFetch();
  renderWithProviders(<FleetThreads />);
  fireEvent.click(await screen.findByRole("button", { name: /hermes\/wsl · 2 tin/ }));
  expect(await screen.findByText("<b>x</b> & báo cáo")).toBeInTheDocument();
  expect(document.querySelector("b")).toBeNull();
});

it("replies to the latest agent that spoke, and shows the kind the server stored", async () => {
  const posted: { body?: unknown; response?: unknown } = { response: { kind: "question" } };
  stubFetch(posted);
  renderWithProviders(<FleetThreads />);
  fireEvent.click(await screen.findByRole("button", { name: /hermes\/wsl · 2 tin/ }));
  await screen.findByText("<b>x</b> & báo cáo");
  fireEvent.change(screen.getByLabelText("Nội dung"), { target: { value: "làm tiếp đi" } });
  fireEvent.click(screen.getByRole("button", { name: "Gửi vào chuỗi" }));
  await waitFor(() => expect(posted.body).toEqual({ to: "hermes/wsl", body: "làm tiếp đi" }));
  expect(await screen.findByText("Chưa có agent nhận đích này; tin đã lưu thành câu hỏi.")).toBeInTheDocument();
});

it("disables send for a draft over 8 KB", async () => {
  stubFetch();
  renderWithProviders(<FleetThreads />);
  fireEvent.click(await screen.findByRole("button", { name: /hermes\/wsl · 2 tin/ }));
  await screen.findByText("<b>x</b> & báo cáo");
  fireEvent.change(screen.getByLabelText("Nội dung"), { target: { value: "a".repeat(8193) } });
  expect(screen.getByRole("button", { name: "Gửi vào chuỗi" })).toBeDisabled();
  expect(screen.getByText(/quá 8 KB/)).toBeInTheDocument();
});
