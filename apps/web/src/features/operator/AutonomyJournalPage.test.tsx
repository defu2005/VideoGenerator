import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AUTONOMY_PRESETS } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { StopAutonomyButton } from "../../components/layout/AppLayout";
import { NeedsYouList } from "../dashboard/DashboardPage";
import { AutonomyJournalPage } from "./AutonomyJournalPage";
import { AutonomySettingsPanel } from "./AutonomySettingsPanel";

it("warns when a goal asks for more videos than the quota allows", async () => {
  const settings = { level: "assist", grants: AUTONOMY_PRESETS.assist };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (String(path).includes("/supervisor")) return jsonResponse({ heartbeat: null, findings: [] });
    if (String(path).includes("/budget")) return jsonResponse({ overrides: {}, app: { dailyUsd: null, monthlyUsd: null, maxRendersPerDay: null, maxPublishesPerDayPerAccount: null, maxOperatorRunsPerDay: null, maxQuestionsPerDay: 3 }, effective: { dailyUsd: null, monthlyUsd: null, maxRendersPerDay: null, maxPublishesPerDayPerAccount: null, maxOperatorRunsPerDay: null, maxQuestionsPerDay: 3 } });
    return jsonResponse({ settings, effective: settings });
  }));
  renderWithProviders(<AutonomySettingsPanel profileId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);
  fireEvent.change(await screen.findByLabelText("Mục tiêu"), { target: { value: "10 video mỗi ngày" } });
  expect(await screen.findByRole("alert")).toHaveTextContent(/6/);
});

it("lists a cần bạn request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
    requests: [{ id: "r1", title: "Nhập key Gemini", actionUrl: "/settings/keys?provider=gemini", whyVi: "Bước nghiên cứu đang chờ." }],
  })));
  renderWithProviders(<NeedsYouList />);
  expect(await screen.findByRole("link", { name: "Nhập key Gemini" })).toHaveAttribute("href", "/settings/keys?provider=gemini");
});

it("filters the journal and undoes a row", async () => {
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => jsonResponse(init?.method === "POST" ? { undone: true } : {
    rows: [{ id: "11111111-1111-4111-8111-111111111111", tool: "apply_models", origin: "supervisor", summary: "Đổi model", createdAt: "2026-11-10T00:00:00.000Z", undo: { type: "settings" } }],
  }));
  vi.stubGlobal("fetch", fetchMock);
  renderWithProviders(<AutonomyJournalPage />);
  expect(await screen.findByText("apply_models")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  fireEvent.change(screen.getByLabelText("Lọc công cụ"), { target: { value: "apply_models" } });
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes("tool=apply_models"))).toBe(true));
});

it("shows the stop button only while autonomy is on", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ effective: { level: "autonomous" } })));
  renderWithProviders(<StopAutonomyButton />);
  expect(await screen.findByRole("button", { name: "Dừng tự vận hành" })).toBeInTheDocument();
});
