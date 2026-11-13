import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { NodesPage } from "./NodesPage";

afterEach(() => vi.restoreAllMocks());

const cfg = { concurrency: 1, drain: false, capabilities: ["render"] };
const node = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, name, status, version: "1.0.0", capabilities: ["render"], resources: null, desiredConfig: cfg,
  lastSeenAt: null, createdAt: "2026-11-13T00:00:00Z", revokedAt: null, runningJobs: 0, probe: null, ...extra,
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider><NodesPage /></ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NodesPage", () => {
  it("lists nodes with status, probe failure and an update-all button that drains mismatched nodes", async () => {
    const patched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/me")) return ok({ allowed: ["nodes.manage"] });
      if (init?.method === "PATCH") { patched.push(path); return ok({}); }
      if (path.endsWith("/nodes")) {
        return ok({
          settings: { mode: "prefer", remoteWaitSec: 30 },
          targetVersion: "2.0.0",
          nodes: [
            node("n1", "may-a", "version_mismatch"),
            node("n2", "may-b", "online", { probe: { render: { ok: false, reason: "Thiếu ffmpeg", checkedAt: "2026-11-13T00:00:00Z" } } }),
          ],
        });
      }
      return ok({});
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText("may-a")).toBeTruthy());
    expect(screen.getByText("Cần cập nhật")).toBeTruthy();
    expect(screen.getByText("Dựng thử lỗi: Thiếu ffmpeg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật tất cả (1)" }));
    await waitFor(() => expect(patched).toEqual(["/api/nodes/n1"]));
    expect(screen.getByText(/docker compose -f compose.worker.yml pull/)).toBeTruthy();
  });

  it("shows stage placement, capability versions and the secret audit, and saves a partial update", async () => {
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/me")) return ok({ allowed: ["nodes.manage"] });
      if (init?.method === "PUT") { puts.push(JSON.parse(String(init.body))); return ok({}); }
      if (path.endsWith("/nodes/secrets")) {
        return ok({ grants: [{ id: "g1", nodeId: "n1", nodeName: "may-a", jobId: "job-1", stage: "VOICE", scope: "tts:google_cloud", label: "Google Cloud TTS", createdAt: "2026-11-13T00:00:00Z", expiresAt: "2026-11-13T00:10:00Z", revokedAt: null, revokedReason: null, summary: "Node may-a nhận khoá Google Cloud TTS cho job job-1, hết hạn lúc 00:10:00 13/11/2026" }] });
      }
      if (path.endsWith("/nodes")) {
        return ok({
          settings: { mode: "off", remoteWaitSec: 30, stages: { RENDER: "off", VOICE: "off", MEDIA_FETCH: "off" }, localOnlyKeys: [] },
          targetVersion: "1.0.0",
          nodes: [node("n1", "may-a", "online", { capabilities: ["render", "tts:piper"], capabilityInfo: { render: "1.0.0", "tts:piper": "1.0.0" }, desiredConfig: { concurrency: 1, drain: false, capabilities: ["render", "tts:piper"] } })],
        });
      }
      return ok({});
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Node may-a nhận khoá Google Cloud TTS/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Chế độ Tạo giọng đọc (TTS)"), { target: { value: "prefer" } });
    await waitFor(() => expect(puts).toContainEqual({ stages: { VOICE: "prefer" } }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Không gửi khoá Google Cloud ra node/ }));
    await waitFor(() => expect(puts).toContainEqual({ localOnlyKeys: ["tts.google_cloud.apiKey"] }));
    fireEvent.click(screen.getByText("may-a"));
    await waitFor(() => expect(screen.getByText("Khả năng: render (1.0.0), tts:piper (1.0.0)")).toBeTruthy());
  });

  it("shows a no-permission message without loading nodes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return ok({ allowed: [] });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("không có quyền"));
    expect(calls.some((path) => path.endsWith("/nodes"))).toBe(false);
  });
});
