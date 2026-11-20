import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, jsonResponse } from "../../test/testUtils";
import { LlmRelaySection } from "./LlmRelaySection";

afterEach(() => vi.unstubAllGlobals());
const grant = { caller: "*", workspaceId: null, models: [], rpm: 30, tpm: 200000, dailyUsdCap: 2, enabled: true, updatedAt: "" };
const status = {
  configured: true, reachable: true, modelCount: 2, lastError: null, gatewayMode: "only", defaultGrant: grant, models: ["fast", "smart"],
  callers: [{ caller: "node:n1", label: "Máy một", calls: 4, refused: 1, inputTokens: 1000, outputTokens: 500, costUsd: 0.0123, lastRefusal: "RELAY_RATE_LIMITED", lastRefusalAt: "x", grant: null }],
};

it("shows relay usage per machine and saves a changed limit without ever showing a key", async () => {
  let saved: unknown;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") { saved = JSON.parse(String(init.body)); return jsonResponse({ grant }); }
    return jsonResponse(status);
  }));
  renderWithProviders(<LlmRelaySection />);
  expect(await screen.findByText("Relay sẵn sàng")).toBeInTheDocument();
  expect(screen.getAllByText("Máy một").length).toBeGreaterThan(0);
  expect(screen.getByText(/vượt tốc độ cho phép/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sửa giới hạn" }));
  fireEvent.change(await screen.findByLabelText("Lời gọi mỗi phút"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu giới hạn" }));
  await waitFor(() => expect(saved).toMatchObject({ caller: "node:n1", rpm: 5 }));
  expect(await screen.findByText("Đã lưu giới hạn.")).toBeInTheDocument();
});

it("shows unknown spend as unknown and labels estimated token counts", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...status,
    callers: [{ ...status.callers[0], costUsd: 0, costUnknown: true, tokensUnknown: true }] })));
  renderWithProviders(<LlmRelaySection />);
  expect(await screen.findByText("Chưa rõ")).toBeInTheDocument();
  expect(screen.getByText(/1.500 \(ước tính\)/)).toBeInTheDocument();
  expect(screen.queryByText("$0.0000")).not.toBeInTheDocument();
});
