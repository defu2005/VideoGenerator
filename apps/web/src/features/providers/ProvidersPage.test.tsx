import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ProvidersPage } from "./ProvidersPage";

afterEach(() => vi.unstubAllGlobals());

const page = {
  overview: [{ id: "registered", questionVi: "Nhà cung cấp nào đã có trong danh mục?", answerVi: "1 nhà cung cấp đã được ghi." }],
  providers: [{
    id: "groq",
    name: "Groq",
    website: "https://groq.com",
    needsResearch: false,
    score: 92,
    riskLevel: "HIGH",
    flags: ["BILLING_RISK"],
    autoConfigAllowed: false,
    vietnam: true,
    cardRequired: false,
  }],
  connections: { needsToken: true, stepsVi: "Tự tạo token chỉ đọc trên OmniRoute.", connections: [] },
  offers: { active: [], expired: [], expiring: [] },
  billing: [{ providerId: "groq", name: "Groq", riskLevel: "HIGH", unverified: true, flags: ["BILLING_RISK"], autoConfigAllowed: false }],
  changes: [],
  profiles: [{ id: "video", titleVi: "Ứng dụng video" }],
  proposals: [{ id: "prop-1", profileId: "video", diffVi: "Hồ sơ video: trống -> groq/fast", modelIds: ["groq/fast"] }],
  feeds: [{ url: "https://groq.com/blog", label: "Groq blog" }],
  suites: [{ id: "script-short", titleVi: "Kịch bản ngắn", cases: 8 }],
  needsTokenStepsVi: "Tự tạo token chỉ đọc trên OmniRoute.",
};

describe("ProvidersPage", () => {
  it("shows paired model metrics and keeps the baseline below the quality threshold", async () => {
    const compare = vi.fn();
    const metrics = { provider: "mock", cases: 8, schemaErrorRate: 0, averageLatencyMs: 12, totalTokens: 20, estimatedCostUsd: 0 };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/provider-intel/page")) return jsonResponse(page);
      compare(JSON.parse(String(init?.body)));
      return jsonResponse({
        runId: "fixture", stopped: false, recommendation: "keep_baseline",
        baseline: { ...metrics, model: "baseline", quality: 1 },
        candidate: { ...metrics, model: "candidate", quality: 0.5 },
      });
    }));
    renderWithProviders(<ProvidersPage />, ["/providers"]);
    fireEvent.click(await screen.findByRole("button", { name: "Năng lực và benchmark" }));
    fireEvent.change(screen.getByLabelText("Model hiện tại"), { target: { value: "mock/baseline" } });
    fireEvent.change(screen.getByLabelText("Model ứng viên"), { target: { value: "mock/candidate" } });
    fireEvent.click(screen.getByRole("button", { name: "Chạy so sánh" }));
    expect(await screen.findByText("Giữ model hiện tại.")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(compare).toHaveBeenCalledWith({
      suiteId: "script-short", baseline: { provider: "mock", model: "baseline" },
      candidate: { provider: "mock", model: "candidate" },
    });
  });

  it("shows the score and the risk chip, saves the checklist, and applies only after a click", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/provider-intel/page")) return jsonResponse(page);
      return jsonResponse({ ok: true });
    }));

    renderWithProviders(<ProvidersPage />, ["/providers"]);
    expect(await screen.findByRole("heading", { name: "Nhà cung cấp AI" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Danh mục nhà cung cấp" }));
    expect(screen.getByText("92")).toBeInTheDocument();
    expect(screen.getByText("BILLING_RISK")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rủi ro thanh toán" }));
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã kiểm tra trên dashboard" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/provider-intel/providers/groq/checklist"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Định tuyến" }));
    expect(screen.getByText("Hồ sơ video: trống -> groq/fast")).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/routing/apply"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/provider-intel/routing/apply"))).toBe(true));
  });
});
