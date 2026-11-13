import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, jsonResponse } from "../../test/testUtils";
import { ProfileKnowledgeTab } from "./ProfileKnowledgeTab";
import { KnowledgeUsesPanel } from "./KnowledgeUsesPanel";
import { EmbeddingRow } from "../settings/EmbeddingRow";
afterEach(() => vi.unstubAllGlobals());
const settings = { settings: { indexComments: false, profiles: {} }, providers: [] };
describe("channel knowledge", () => {
    it("renders status, enqueues rebuild and searches", async () => {
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); if (url.endsWith("/status"))
            return jsonResponse({ total: 12, counts: { script: 12 }, embeddingCoverage: 0, embeddingModel: null, lastIndexedAt: "2026-11-09", chunksOverCap: 0, ftsAvailable: true, indexing: false }); if (url.endsWith("/settings"))
            return jsonResponse(settings); if (url.endsWith("/search"))
            return jsonResponse({ mode: "text", matches: [{ chunkId: 1, kind: "script", title: "Vũ trụ", text: "Hố đen", sourceId: "fixture", sourceVersion: "1", score: 0.1, breakdown: { bm25: -1, vector: null, boost: 1 } }] }); return jsonResponse({ queued: true }); });
        vi.stubGlobal("fetch", fetch);
        renderWithProviders(<ProfileKnowledgeTab profileId="fixture"/>);
        expect(await screen.findByText("12 đoạn đã lập chỉ mục")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Lập lại chỉ mục" }));
        await screen.findByText("Đã đưa vào hàng đợi.");
        expect(fetch).toHaveBeenCalledWith("/api/retrieval/profiles/fixture/rebuild", expect.objectContaining({ method: "POST" }));
        fireEvent.change(screen.getByLabelText("Thử tìm"), { target: { value: "vu tru" } });
        fireEvent.click(screen.getByRole("button", { name: "Thử tìm" }));
        expect(await screen.findByText("Hố đen")).toBeInTheDocument();
    });
    it("sends an exclusion and asks for a manual rerun", async () => {
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT" ? jsonResponse({ ok: true }) : jsonResponse({ uses: [{ id: 1, stage: "SCRIPT", task_id: "script", chunks: [{ chunkId: 7, title: "Nguồn trước", text: "Kết quả cũ", kind: "script", excluded: false }] }] }));
        vi.stubGlobal("fetch", fetch);
        renderWithProviders(<KnowledgeUsesPanel projectId="fixture" tasks={["script"]}/>);
        expect(await screen.findByText("Nguồn trước")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Bỏ đoạn này", hidden: true }));
        expect(await screen.findByText("Chạy lại bước này để áp dụng.")).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledWith("/api/retrieval/projects/fixture/exclusions", expect.objectContaining({ method: "PUT", body: JSON.stringify({ chunkId: 7, excluded: true }) }));
    });
    it("hides model controls when no provider can embed", async () => { vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(settings))); renderWithProviders(<EmbeddingRow />); expect(await screen.findByText(/Tìm theo nghĩa cần/)).toBeInTheDocument(); expect(screen.queryByLabelText("Model embedding")).not.toBeInTheDocument(); });
    it("saves an embedding model and tests the saved configuration", async () => {
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/test") ? jsonResponse({ ok: true }) : jsonResponse({ settings: { ...settings.settings, embeddingProvider: "mock", embeddingModel: "mock-v1" }, providers: [{ id: "mock", label: "Mock" }] }));
        vi.stubGlobal("fetch", fetch);
        renderWithProviders(<EmbeddingRow />);
        await screen.findByLabelText("Model embedding");
        fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
        expect(await screen.findByText("Embedding hoạt động.")).toBeInTheDocument();
    });
});
