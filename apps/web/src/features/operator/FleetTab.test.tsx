import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { FleetSettingsSchema } from "@vg/shared";
import { renderWithProviders, jsonResponse } from "../../test/testUtils";
import { FleetTab } from "./FleetTab";

afterEach(() => vi.unstubAllGlobals());
it("shows drift repairs and lets the user save the shared fleet configuration", async () => {
  let saved: unknown;
  const data = { settings: FleetSettingsSchema.parse({}), bundleVersion: 3, hash: "fixture", toolHash: "fixture", instances: [{ instance: "hermes/wsl", environment: "wsl", host: "fixture", hermesVersion: "0.1.0", bundleVersion: 1, lastSyncAt: null, lastError: null, pendingCron: ["hermes cron create fixture"], issues: [{ kind: "fleet_version_drift", detail: "Đổi image tag thành 0.23.1" }] }] };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/settings/hermes-fleet")) { saved = JSON.parse(String(init?.body)); return jsonResponse({ settings: saved }); }
    return jsonResponse(data);
  }));
  renderWithProviders(<FleetTab />);
  expect(await screen.findByText("hermes/wsl")).toBeInTheDocument();
  expect(screen.getByText("Đổi image tag thành 0.23.1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Chép lệnh cron" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "new-model" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu đội Hermes" }));
  await waitFor(() => expect(saved).toMatchObject({ model: "new-model", autoActivateReadOnlySkills: false }));
  expect(await screen.findByText("Đã lưu cấu hình đội Hermes.")).toBeInTheDocument();
});
