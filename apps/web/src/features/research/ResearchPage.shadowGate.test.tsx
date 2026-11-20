import { afterEach, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { SelfImprovementSettingsSchema } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ResearchPage } from "./ResearchPage";

afterEach(() => vi.unstubAllGlobals());

// Own file: useCan caches /me per module, so this user (no operator.use) cannot share a module with the allowed user.
it("hides the shadow switch from a user who cannot use the operator", async () => {
  const settings = SelfImprovementSettingsSchema.parse({});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/me")) return jsonResponse({ allowed: ["settings.write"] });
    return jsonResponse({ settings, runs: [], skills: [], budget: { used: {}, limits: settings.budget }, runtimes: [{ id: "model", label: "Model" }] });
  }));
  renderWithProviders(<ResearchPage />, ["/self-improvement"]);
  expect(await screen.findByRole("button", { name: "Lưu giới hạn" })).toBeInTheDocument();
  // Until /me answers, the card is shown (unknown counts as allowed); once it answers without operator.use, it goes.
  await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Ghi nhận lệnh shadow" })).not.toBeInTheDocument());
});
