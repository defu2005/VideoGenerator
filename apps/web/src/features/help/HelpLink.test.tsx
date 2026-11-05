import { featureForPathname, featureMap, helpHref } from "@vg/shared";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "../../components/layout/AppLayout";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

describe("contextual help link", () => {
  it("resolves a help URL for every route in the feature map", () => {
    for (const feature of featureMap) {
      for (const route of feature.webRoutes) {
        const sample = route.replace(/:[A-Za-z]+/g, "x");
        const match = featureForPathname(sample);
        expect(match, route).toBeTruthy();
        expect(helpHref(match!)).toMatch(/^\/help\/[A-Za-z0-9-]+#[A-Za-z0-9-]+$/);
      }
    }
  });

  it("opens the AI guide from the models page and the automation guide from a profile tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ count: 0 })));
    const { unmount } = renderWithProviders(<AppLayout />, ["/settings/ai"]);
    expect(await screen.findByTestId("context-help")).toHaveAttribute("href", "/help/mo-hinh-ai#dinh-tuyen");
    expect(screen.getByRole("link", { name: "Hướng dẫn" })).toHaveAttribute("href", "/help");
    unmount();

    renderWithProviders(<AppLayout />, ["/profiles/e6c2f6f3-3e6f-434d-94ae-77d7f4c912f0/automation"]);
    expect(await screen.findByTestId("context-help")).toHaveAttribute("href", "/help/tu-dong-hoa#lich-tu-dong");
  });
});
