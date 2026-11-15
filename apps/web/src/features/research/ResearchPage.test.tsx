import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SelfImprovementSettingsSchema } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ResearchPage } from "./ResearchPage";
afterEach(() => vi.unstubAllGlobals());
it("starts a knowledge refresh explicitly, shows the report/proposal, and saves user budget settings", async () => {
  let settings = SelfImprovementSettingsSchema.parse({});
  const run = { id: "11111111-1111-4111-8111-111111111111", skill: "research-knowledge-refresh", subject: "dependency.fixture", status: "completed", report: "Đã đối chiếu nguồn; đề xuất chờ duyệt.", createdAt: "2026-11-15T00:00:00Z", proposalIds: ["proposal-fixture"], budgetUsed: { llmCalls: 4 }, details: { pages: [{ url: "https://official.test/policy" }] } };
  let runs: unknown[] = [], request: unknown, saved: unknown;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/me")) return jsonResponse({ allowed: ["settings.write"] });
    if (url.endsWith("/research/runs")) { request = JSON.parse(String(init?.body)); runs = [run]; return jsonResponse(run); }
    if (url.endsWith("/research/settings")) { saved = JSON.parse(String(init?.body)); settings = SelfImprovementSettingsSchema.parse(saved); return jsonResponse({ settings }); }
    return jsonResponse({ settings, runs, skills: [{ name: "research-knowledge-refresh", description: "Làm mới tri thức" }], budget: { used: Object.fromEntries(Object.keys(settings.budget).map((key) => [key, 0])), limits: settings.budget }, runtimes: [{ id: "model", label: "Model theo định tuyến" }] });
  }));
  renderWithProviders(<ResearchPage />, ["/self-improvement?knowledgeId=dependency.fixture"]);
  expect(await screen.findByLabelText("Chủ đề hoặc điều cần kiểm tra")).toHaveValue("dependency.fixture");
  fireEvent.click(screen.getByRole("button", { name: "Bắt đầu nghiên cứu (dùng ngân sách)" }));
  await waitFor(() => expect(request).toMatchObject({ skill: "research-knowledge-refresh", knowledgeId: "dependency.fixture" }));
  expect(await screen.findByText("Đã đối chiếu nguồn; đề xuất chờ duyệt.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Xem đề xuất proposal-fixture" })).toHaveAttribute("href", "/settings/knowledge?tab=pending&proposal=proposal-fixture");
  fireEvent.change(screen.getByLabelText("Lượt nghiên cứu mỗi ngày"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu giới hạn" }));
  await waitFor(() => expect(saved).toMatchObject({ budget: { researchRuns: 2 } }));
  expect(await screen.findByText("Đã lưu giới hạn.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Nhật ký" }));
  expect(screen.getByText("Nhật ký tự cải tiến")).toBeInTheDocument();
});
it("opens a linked older report even when it is outside the latest runs list", async () => {
  const settings = SelfImprovementSettingsSchema.parse({});
  const id = "11111111-1111-4111-8111-111111111111";
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith(`/research/runs/${id}`)) return jsonResponse({ id, skill: "research-provider", subject: "Older linked report", status: "completed", report: "Báo cáo vẫn đọc được.", createdAt: "2026-11-01T00:00:00Z", proposalIds: [], budgetUsed: {}, details: {} });
    if (String(input).endsWith("/me")) return jsonResponse({ allowed: ["settings.write"] });
    return jsonResponse({ settings, runs: [], skills: [], budget: { used: {}, limits: settings.budget }, runtimes: [{ id: "model", label: "Model" }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWithProviders(<ResearchPage />, [`/self-improvement?run=${id}`]);
  expect(await screen.findByText("Báo cáo vẫn đọc được.")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/research/runs/${id}`))).toBe(true);
});
