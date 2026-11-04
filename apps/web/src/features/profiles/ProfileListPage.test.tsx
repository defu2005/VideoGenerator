import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileListPage } from "./ProfileListPage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const profile = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Lịch sử 5 phút",
  description: "Kênh lịch sử ngắn",
  direction: "Kể chuyện lịch sử Việt Nam",
  language: "vi",
  color: "#C45C26",
  avatarPath: null,
  archivedAt: null,
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
  accountCount: 1,
  projectCount: 2,
  accounts: [{
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    platform: "youtube",
    displayName: "Lịch sử 5 phút",
    handle: "@lichsu",
    format: "landscape",
    enabled: true,
    connection: "NOT_CONNECTED",
  }],
};

describe("ProfileListPage", () => {
  it("renders profile cards", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ items: [profile] }))));
    renderWithProviders(<ProfileListPage />, ["/profiles"]);
    expect(await screen.findByRole("heading", { name: "Lịch sử 5 phút" })).toBeInTheDocument();
    expect(screen.getByText("2 dự án")).toBeInTheDocument();
    expect(screen.getByText(/YouTube/)).toBeInTheDocument();
  });
});
