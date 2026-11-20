import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SelfImprovementSettingsSchema } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ResearchPage } from "./ResearchPage";

afterEach(() => vi.unstubAllGlobals());

it("turns the shadow recording switch on through operator settings and reads it back", async () => {
  const settings = SelfImprovementSettingsSchema.parse({});
  let shadowEnabled = false;
  let saved: unknown;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/me")) return jsonResponse({ allowed: ["settings.write", "operator.use"] });
    if (url.endsWith("/api/operator/settings")) {
      saved = JSON.parse(String(init?.body));
      shadowEnabled = (saved as { shadowEnabled: boolean }).shadowEnabled;
      return jsonResponse({ ok: true });
    }
    if (url.endsWith("/api/operator/overview")) return jsonResponse({ settings: { shadowEnabled } });
    return jsonResponse({ settings, runs: [], skills: [], budget: { used: {}, limits: settings.budget }, runtimes: [{ id: "model", label: "Model" }] });
  }));
  renderWithProviders(<ResearchPage />, ["/self-improvement"]);
  const box = await screen.findByRole("checkbox", { name: "Ghi nhận lệnh shadow" });
  await waitFor(() => expect(box).not.toBeDisabled());
  expect(box).not.toBeChecked();
  fireEvent.click(box);
  await waitFor(() => expect(saved).toEqual({ shadowEnabled: true }));
  expect(await screen.findByText("Đã lưu công tắc shadow.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Ghi nhận lệnh shadow" })).toBeChecked());
});
