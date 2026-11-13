import { fireEvent, screen, within } from "@testing-library/react";
import { AUTONOMY_PRESETS, DEFAULT_AUTONOMY_BUDGET } from "@vg/shared";
import { expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AutonomySettingsPanel } from "./AutonomySettingsPanel";

it("fills the preset and confirms the listed grants before saving full autonomy", async () => {
  const initial = { level: "assist", grants: AUTONOMY_PRESETS.assist };
  let settings = initial;
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
    if (_path.endsWith("/supervisor")) return jsonResponse({
      heartbeat: { observedAt: "2026-11-10T00:00:00.000Z", runningJobs: 1, queuedJobs: 2 },
      findings: [{ id: "fixture", kind: "worker_idle", severity: "critical", status: "escalated" }],
    });
    if (_path.endsWith("/budget")) {
      const overrides = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse({ overrides, app: DEFAULT_AUTONOMY_BUDGET, effective: { ...DEFAULT_AUTONOMY_BUDGET, ...overrides } });
    }
    if (init?.body) settings = JSON.parse(String(init.body));
    return jsonResponse({ settings, effective: settings });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWithProviders(<AutonomySettingsPanel />);
  fireEvent.change(await screen.findByLabelText("Mức tự chủ"), { target: { value: "autonomous" } });
  expect(screen.getByLabelText("Quản lý chủ đề")).toBeChecked();
  expect(screen.getByLabelText("Điều khiển màn hình")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Lưu quyền" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Đăng: Công khai");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Lưu quyền" }));
  await screen.findByText(/Quyền hiệu lực đã lưu · Toàn quyền/);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  fireEvent.click(screen.getByText("Ngân sách tự vận hành"));
  fireEvent.change(await screen.findByLabelText("Chi mỗi ngày (USD)"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu hạn mức" }));
  await screen.findByText("Đã lưu hạn mức.");
  expect(fetchMock.mock.calls.some(([path, init]) => path.endsWith("/budget") && init?.body === '{"dailyUsd":0}')).toBe(true);
  fireEvent.click(screen.getByText("Giám sát tự vận hành"));
  expect(await screen.findByText("Worker chưa nhận job · Cần xử lý")).toBeInTheDocument();
  expect(screen.getByText(/1 job đang chạy và 2 job chờ/)).toBeInTheDocument();
});
