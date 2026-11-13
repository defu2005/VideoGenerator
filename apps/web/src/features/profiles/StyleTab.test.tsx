import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_STYLE_TOKENS } from "@vg/shared";
import { StyleTab } from "./StyleTab";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tokens = BASE_STYLE_TOKENS;
const color = { bg: "#0F172A", bgAlt: "#1E293B", text: "#FFFFFF", accent: "#38BDF8", accent2: "#F59E0B" };
const style = { fingerprint: "fp1", color, fonts: { display: "be-vietnam-pro", body: "be-vietnam-pro" }, issues: { contrast: [], fonts: [] }, adjusted: [] };
const pack = (version: number, kind = "preset") => ({ version, name: `v${version}`, origin: { kind } });

let calls: Array<{ url: string; method: string; body: unknown }>;

function mockApi(extra: Record<string, (body: unknown) => Response> = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const key = `${method} ${url.replace(/^.*\/api/, "")}`;
    if (extra[key]) return extra[key]!(body);
    if (key.endsWith("/style/presets")) return jsonResponse({ presets: [{ id: "paper", nameVi: "Giấy", descriptionVi: "Nền sáng như giấy" }] });
    if (key.endsWith("/style-pack/versions")) {
      return jsonResponse({ versions: [
        { version: 2, name: "v2", origin: { kind: "brand" }, fingerprint: "b", current: true, tokens },
        { version: 1, name: "v1", origin: { kind: "preset" }, fingerprint: "a", current: false, tokens },
      ] });
    }
    if (key.startsWith("GET") && key.endsWith("/style-pack")) return jsonResponse({ pack: pack(2, "brand"), tokens });
    return jsonResponse({ error: { code: "NOT_FOUND", message: "x" } }, 404);
  }));
}

beforeEach(() => mockApi());
afterEach(() => vi.unstubAllGlobals());

describe("StyleTab", () => {
  it("shows the current pack and its version history", async () => {
    renderWithProviders(<StyleTab profileId={profileId} />);
    expect(await screen.findByText(/Bản hiện tại: v2/)).toBeTruthy();
    expect(screen.getByText(/Lịch sử phiên bản/)).toBeTruthy();
    expect(screen.getByText(/v1 · Mẫu có sẵn/)).toBeTruthy();
    expect(screen.getByText(/đang dùng/)).toBeTruthy();
  });

  it("asks for confirmation before saving a preset, then calls from-preset", async () => {
    mockApi({
      [`POST /profiles/${profileId}/style-pack/from-preset`]: () => jsonResponse({ pack: pack(3), tokens, changed: true, style, similar: [{ profileId: "x", name: "Kênh Y", score: 0.9 }] }),
    });
    renderWithProviders(<StyleTab profileId={profileId} />);
    await screen.findByText(/Bản hiện tại/);
    fireEvent.click(screen.getByRole("button", { name: "Chọn mẫu" }));
    fireEvent.change(await screen.findByLabelText("Mẫu phong cách"), { target: { value: "paper" } });
    fireEvent.click(screen.getByRole("button", { name: "Dùng mẫu" }));
    expect(calls.some((call) => call.url.endsWith("/from-preset"))).toBe(false);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu", hidden: true }));
    await waitFor(() => expect(calls.find((call) => call.url.endsWith("/from-preset"))?.body).toEqual({ presetId: "paper" }));
    expect(await screen.findByText(/Giống kênh khác: Kênh Y \(90%\)/)).toBeTruthy();
  });

  it("shows the AI draft with what was dropped and does not save it by itself", async () => {
    mockApi({
      [`POST /profiles/${profileId}/style-pack/propose`]: () => jsonResponse({ pack: pack(3, "llm"), tokens, dropped: ["hologram: không có trong hệ thống"], source: "llm", message: "AI gợi ý", style, similar: [] }),
    });
    renderWithProviders(<StyleTab profileId={profileId} />);
    await screen.findByText(/Bản hiện tại/);
    fireEvent.change(screen.getByLabelText(/Ghi chú cho AI/), { target: { value: "sạch" } });
    fireEvent.click(screen.getByRole("button", { name: "Gợi ý bằng AI" }));
    expect(await screen.findByText(/hologram/)).toBeTruthy();
    expect(calls.find((call) => call.url.endsWith("/propose"))?.body).toEqual({ note: "sạch" });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("enables saving only after an edit and can undo it", async () => {
    renderWithProviders(<StyleTab profileId={profileId} />);
    await screen.findByText(/Bản hiện tại/);
    expect(screen.queryByRole("alert", { name: "Cảnh báo tương phản" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tốc độ cắt"), { target: { value: "0.8" } });
    expect(screen.getByRole("button", { name: "Lưu thay đổi" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác chỉnh sửa" }));
    expect(screen.getByRole("button", { name: "Lưu thay đổi" }).hasAttribute("disabled")).toBe(true);
  });

  it("reverts to an older version after confirmation", async () => {
    mockApi({
      [`POST /profiles/${profileId}/style-pack/revert`]: () => jsonResponse({ pack: pack(3), tokens, changed: true, style, similar: [] }),
    });
    renderWithProviders(<StyleTab profileId={profileId} />);
    fireEvent.click(await screen.findByRole("button", { name: "Quay lại bản này" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu", hidden: true }));
    await waitFor(() => expect(calls.find((call) => call.url.endsWith("/revert"))?.body).toEqual({ version: 1 }));
  });

  it("shows the server's Vietnamese refusal", async () => {
    mockApi({
      [`POST /profiles/${profileId}/style-pack/from-brand`]: () => jsonResponse({ error: { code: "STYLE_CONTRAST", message: "Chữ khó đọc" } }, 400),
    });
    renderWithProviders(<StyleTab profileId={profileId} />);
    await screen.findByText(/Bản hiện tại/);
    fireEvent.click(screen.getByRole("button", { name: "Từ màu thương hiệu" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu", hidden: true }));
    expect(await screen.findByText("Chữ khó đọc")).toBeTruthy();
  });
});
