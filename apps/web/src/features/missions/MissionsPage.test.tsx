import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { MissionsPage } from "./MissionsPage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const id = "11111111-1111-4111-8111-111111111111";
const mission = (state: string) => ({
  id, command: "làm 3 video", state, owner: null, autonomyLevel: "assist", projectIds: ["p1"],
  plan: [], report: null, channelProfileId: null, deadline: null, budgetUsd: null,
  createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:00:00.000Z",
});

function renderDetail(state: string, bodies: unknown[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") bodies.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith(`/api/missions/${id}`)) return jsonResponse({ mission: mission(state), checkpoints: [] });
    if (url.includes("/api/missions")) return jsonResponse({ missions: [mission(state)] });
    return jsonResponse({ mission: mission(state) });
  }));
  return renderWithProviders(
    <Routes><Route path="/missions/:id" element={<MissionsPage />} /></Routes>,
    [`/missions/${id}`],
  );
}

describe("MissionsPage", () => {
  it("shows the resume button only while the mission waits for the user", async () => {
    renderDetail("waiting_user");
    expect(await screen.findByRole("button", { name: "Gỡ chờ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /duyệt/i })).toBeNull();
  });

  it("labels the autonomy level with a real server value", async () => {
    renderDetail("producing");
    expect(await screen.findByText(/Mức mission: assist/)).toBeTruthy();
  });

  it("hides the resume button in any other state and never offers a gate approval", async () => {
    renderDetail("producing");
    await screen.findByRole("button", { name: "Huỷ mission" });
    expect(screen.queryByRole("button", { name: "Gỡ chờ" })).toBeNull();
    expect(screen.queryByRole("button", { name: /duyệt/i })).toBeNull();
  });

  it("creates a mission with a body the server create schema accepts", async () => {
    const bodies: Array<{ url: string; body: { command: string } | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/api/missions")) {
        bodies.push({ url, body: JSON.parse(String(init.body)) });
        return jsonResponse({ mission: mission("planning") });
      }
      return jsonResponse({ missions: [] });
    }));
    renderWithProviders(
      <Routes><Route path="/missions" element={<MissionsPage />} /></Routes>,
      ["/missions"],
    );
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "  làm 3 video  " } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo mission" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.url).toMatch(/\/api\/missions$/);
    expect(bodies[0]?.body).toEqual({ command: "làm 3 video" });
  });
});
