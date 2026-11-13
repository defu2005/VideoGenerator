import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { SkillReportsPage } from "./SkillReportsPage";

describe("skill report page", () => {
  it("shows the four tabs, an overlap warning and saves a user verdict", async () => {
    const saved = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/verdict")) {
        saved(init?.method);
        return jsonResponse({ id: "11111111-1111-4111-8111-111111111111" });
      }
      if (url.includes("/summary")) return jsonResponse({ items: [] });
      if (url.includes("/agents")) return jsonResponse({ items: [], claims: [] });
      return jsonResponse({
        items: [{
          id: "11111111-1111-4111-8111-111111111111",
          skill: "video-doc-so-lieu",
          profile_name: "Kênh A",
          status: "done",
          hypothesis: "Số liệu tăng",
          verdict: null,
          check_at: "2026-11-01",
          agent_kind: "codex",
          agent_name: "codex-pc",
          agent_environment: "may-nha",
          created_at: "2026-11-10T00:00:00.000Z",
        }],
        overlap: [{ profileName: "Kênh A", environment: "vps-1" }],
      });
    }));
    renderWithProviders(<SkillReportsPage />);
    expect(await screen.findByRole("tab", { name: "Tất cả" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cần kiểm chứng" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Theo skill" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Agent" })).toBeTruthy();
    expect(await screen.findByText(/Môi trường khác \(vps-1\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Cần kiểm chứng" }));
    fireEvent.click(await screen.findByRole("button", { name: /Lưu kết luận chưa rõ/ }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("POST"));
  });
});