import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { SkillVersions } from "./SkillVersions";

describe("repo skills panel", () => {
  it("shows channel skills and a rejected file warning", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/operator/skills/repo/video-lich-san-xuat")) {
        return jsonResponse({ markdown: "# Lịch sản xuất\n" });
      }
      return jsonResponse({
        items: [],
        repo: [{ name: "video-lich-san-xuat", area: "kenh", risk: "safe", tools: ["get_profile", "list_topics"], description: "Nhịp sản xuất tuần." }],
        repoRejected: [{ path: ".agents/skills/broken/SKILL.md", errors: ["Công cụ không có trong registry: missing_tool"] }],
      });
    }));
    renderWithProviders(<SkillVersions />);
    expect(await screen.findByText("video-lich-san-xuat")).toBeTruthy();
    expect(screen.getByText(/Sửa file trong \.agents\/skills/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "video-lich-san-xuat" }));
    expect(await screen.findByText(/Lịch sản xuất/)).toBeTruthy();
  });
});
