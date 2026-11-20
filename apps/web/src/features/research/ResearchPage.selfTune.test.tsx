import { afterEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { SelfImprovementSettingsSchema } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ResearchPage } from "./ResearchPage";

// TASK-074c-5b: the budget card shows the self-tune rate and the effective limit. Read-only; the server computes selfTune.
afterEach(() => vi.unstubAllGlobals());

const settings = SelfImprovementSettingsSchema.parse({});
const budget = { used: {}, limits: settings.budget };

function stubOverview(selfTune?: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/me")) return jsonResponse({ allowed: ["settings.write", "operator.use"] });
    return jsonResponse({ settings, runs: [], skills: [], budget, runtimes: [{ id: "model", label: "Model" }], ...(selfTune === undefined ? {} : { selfTune }) });
  }));
  renderWithProviders(<ResearchPage />, ["/self-improvement"]);
}

it("shows that the rate is not ready below 20 decided requests", async () => {
  stubOverview({ window: 20, decided: 0, accepted: 0, rate: null, halved: false, userLimit: 10, effectiveLimit: 10 });
  expect(await screen.findByText("Tự hiệu chỉnh: chưa đủ dữ liệu (0/20 đề xuất đã quyết).")).toBeInTheDocument();
  expect(screen.queryByText(/giảm còn/)).not.toBeInTheDocument();
});

it("shows the acceptance rate and no reduction when the rate is at least 30%", async () => {
  stubOverview({ window: 20, decided: 20, accepted: 6, rate: 0.3, halved: false, userLimit: 10, effectiveLimit: 10 });
  expect(await screen.findByText("Tỉ lệ chấp nhận 30% (20 đề xuất gần nhất).")).toBeInTheDocument();
  expect(screen.queryByText(/giảm còn/)).not.toBeInTheDocument();
});

it("shows the reduced effective limit next to the user's own limit when the rate is below 30%", async () => {
  stubOverview({ window: 20, decided: 20, accepted: 5, rate: 0.25, halved: true, userLimit: 10, effectiveLimit: 5 });
  expect(await screen.findByText("Tỉ lệ chấp nhận 25% (20 đề xuất gần nhất). Hạn mức đề xuất hôm nay giảm còn 5 (bạn đặt 10).")).toBeInTheDocument();
});

it("does not claim a reduction when the user's limit is already 1 and nothing was lowered", async () => {
  stubOverview({ window: 20, decided: 20, accepted: 5, rate: 0.25, halved: true, userLimit: 1, effectiveLimit: 1 });
  expect(await screen.findByText("Tỉ lệ chấp nhận 25% (20 đề xuất gần nhất).")).toBeInTheDocument();
  expect(screen.queryByText(/giảm còn/)).not.toBeInTheDocument();
});

it("keeps the card working when the server sends no selfTune object", async () => {
  stubOverview();
  expect(await screen.findByText("Ngân sách hôm nay")).toBeInTheDocument();
  expect(screen.queryByText(/Tự hiệu chỉnh/)).not.toBeInTheDocument();
});
