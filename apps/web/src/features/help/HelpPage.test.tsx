import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HelpPage } from "./HelpPage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

describe("HelpPage", () => {
  it("shows the quick start and lists a quota search hit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/help/search")) {
        return jsonResponse({
          query: "quota",
          sections: [{
            page: "mo-hinh-ai",
            anchor: "quota",
            title: "Quota",
            text: "Chờ reset khi hết hạn mức.",
            href: "/help/mo-hinh-ai#quota",
          }],
        });
      }
      return jsonResponse({
        page: "README",
        markdown: "## Bắt đầu nhanh trong 10 phút {#bat-dau-nhanh}\n\nLàm một video nháp.",
      });
    }));
    renderWithProviders(<HelpPage />, ["/help"]);
    expect(await screen.findByRole("heading", { name: "Bắt đầu nhanh trong 10 phút" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tìm trong hướng dẫn"), { target: { value: "quota" } });
    expect(await screen.findByRole("link", { name: "Quota" })).toHaveAttribute("href", "/help/mo-hinh-ai#quota");
  });
});
