import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { SkillVersions } from "./SkillVersions";

type Item = Record<string, unknown>;

function version(over: Item): Item {
  return {
    name: "video-probe", version: 2, markdown: "# Thử nghiệm\n", status: "draft", score: 90, activeScore: null,
    evaluation: { score: 90, scenarios: [] }, behaviour: null, shadow: null,
    evidence: { source: "user_review", runIds: [] }, ...over,
  };
}

/** Opens the outer "Xem bản nháp" details and the version's own details, so their buttons are in the accessibility tree. */
async function openAll(name: string) {
  const outer = screen.getByText("Xem bản nháp và các phiên bản").closest("details")!;
  outer.open = true;
  fireEvent(outer, new Event("toggle"));
  const summary = await screen.findByText(new RegExp(`^${name} v`));
  summary.closest("details")!.open = true;
}

function mockFetch(items: Item[], onMutation?: (url: string, method: string) => void) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") { onMutation?.(url, method); return jsonResponse({ ok: true }); }
    if (url.endsWith("/api/operator/skills")) return jsonResponse({ items, repo: [], repoRejected: [] });
    if (url.endsWith("/api/operator/learning-report")) return jsonResponse({ lessons: { operator: [], profiles: [] }, skills: { active: [], drafts: [] }, toolProposals: [] });
    return jsonResponse({});
  }));
}

describe("skill version shadow controls (TASK-074b-3b)", () => {
  it("disables 'Đặt làm shadow' until a behaviour eval has passed", async () => {
    mockFetch([version({ behaviour: null })]);
    renderWithProviders(<SkillVersions />);
    await screen.findByText("Xem bản nháp và các phiên bản");
    await openAll("video-probe");
    expect(screen.getByText("Chưa chạy đánh giá hành vi.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đặt làm shadow" })).toBeDisabled();
  });

  it("enables 'Đặt làm shadow' after a passed eval with a usable judge, shows scores on 0..100, and posts the shadow request", async () => {
    const requests: Array<[string, string]> = [];
    mockFetch([version({
      behaviour: { baseline: "active", activeVersion: 1, passed: true, judgeStatus: "ok", score: 0.8, activeScore: 0.6, ranAt: "2026-11-19T00:00:00.000Z" },
    })], (url, method) => requests.push([url, method]));
    renderWithProviders(<SkillVersions />);
    await screen.findByText("Xem bản nháp và các phiên bản");
    await openAll("video-probe");
    expect(screen.getByText(/Đánh giá hành vi: đạt · 80\/100/)).toBeInTheDocument();
    expect(screen.getByText(/bản nền: bản đang dùng, 60\/100/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Đặt làm shadow" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(requests).toContainEqual(["/api/operator/skills/video-probe/versions/2/shadow", "POST"]));
  });

  it("keeps 'Đặt làm shadow' disabled when the judge did not run, even if the checks passed", async () => {
    mockFetch([version({
      behaviour: { baseline: "builtin", activeVersion: null, passed: true, judgeStatus: "unavailable", score: 0.9, activeScore: null, ranAt: "2026-11-19T00:00:00.000Z" },
    })]);
    renderWithProviders(<SkillVersions />);
    await screen.findByText("Xem bản nháp và các phiên bản");
    await openAll("video-probe");
    expect(screen.getByRole("button", { name: "Đặt làm shadow" })).toBeDisabled();
    expect(screen.getByText(/Judge không sẵn sàng/)).toBeInTheDocument();
  });

  it("shows the shadow progress and tool comparison, and 'Bỏ shadow' removes the shadow", async () => {
    const requests: Array<[string, string]> = [];
    mockFetch([version({
      version: 3, status: "shadow",
      shadow: { runs: 2, firstAt: "2026-11-18T00:00:00.000Z", status: "dang_thu", shadowTools: ["list_topics", "web_search"], baselineTools: ["list_topics"] },
    })], (url, method) => requests.push([url, method]));
    renderWithProviders(<SkillVersions />);
    await screen.findByText("Xem bản nháp và các phiên bản");
    await openAll("video-probe");
    expect(screen.getByText(/Shadow: Đang thử · ghi nhận 2\/5 lượt/)).toBeInTheDocument();
    expect(screen.getByText("Shadow chỉ ghi nhận lệnh sẽ dùng, không chạy công cụ nào.")).toBeInTheDocument();
    expect(screen.getByText("Thêm: web_search · Bỏ: không")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đặt làm shadow" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ shadow" }));
    await waitFor(() => expect(requests).toContainEqual(["/api/operator/skills/video-probe/shadow", "DELETE"]));
  });

  it("disables 'Duyệt và dùng' and gives the reason when the server refuses activation (TASK-074b-4)", async () => {
    mockFetch([version({
      activation: { allowed: false, reasons: ["chưa chạy eval hành vi"] },
    })]);
    renderWithProviders(<SkillVersions />);
    await screen.findByText("Xem bản nháp và các phiên bản");
    await openAll("video-probe");
    expect(screen.getByRole("button", { name: "Duyệt và dùng" })).toBeDisabled();
    expect(screen.getByText("Chưa dùng được: chưa chạy eval hành vi")).toBeInTheDocument();
  });

  it("enables 'Duyệt và dùng' when the server allows activation and the eval score is high enough", async () => {
    mockFetch([version({
      activation: { allowed: true, reasons: [] },
      behaviour: { baseline: "active", activeVersion: 1, passed: true, judgeStatus: "ok", score: 0.9, activeScore: 0.5, ranAt: "2026-11-19T00:00:00.000Z" },
    })]);
    renderWithProviders(<SkillVersions />);
    await screen.findByText("Xem bản nháp và các phiên bản");
    await openAll("video-probe");
    expect(screen.getByRole("button", { name: "Duyệt và dùng" })).toBeEnabled();
    expect(screen.queryByText(/Chưa dùng được/)).not.toBeInTheDocument();
  });
});
