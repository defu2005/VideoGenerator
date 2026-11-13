import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { registerRetrievalRoutes } from "../src/api/retrieval.js";
import { OpenAiCompatibleProvider } from "../src/providers/llm/openaiCompatible.js";
import { GeminiProvider } from "../src/providers/llm/gemini.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { setEmbeddingRegistry, embedTexts } from "../src/retrieval/embeddings.js";
import { saveRetrievalSettings } from "../src/retrieval/settings.js";
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const h of harnesses.splice(0))
    h.close(); });
describe("retrieval API and embedding transport", () => {
    it("validates settings, exposes status and queues rebuilds", async () => {
        const h = createPipelineHarness();
        harnesses.push(h);
        const id = randomUUID(), now = new Date().toISOString();
        h.sqlite.prepare("INSERT INTO profiles(id,name,default_brief,guidelines,created_at,updated_at) VALUES(?,?,?,'{}',?,?)").run(id, id, "{}", now, now);
        const app = Fastify();
        registerRetrievalRoutes(app, h.sqlite);
        expect((await app.inject({ url: '/api/retrieval/profiles/' + id + '/status' })).json()).toMatchObject({ total: 0, embeddingCoverage: 0 });
        expect((await app.inject({ method: "POST", url: '/api/retrieval/profiles/' + id + '/rebuild' })).json()).toEqual({ queued: true });
        expect((await app.inject({ method: "PUT", url: '/api/retrieval/settings', payload: { indexComments: true, profiles: { [id]: { kindsOff: ["comment"] } } } })).json()).toMatchObject({ settings: { indexComments: true } });
        expect((await app.inject({ method: "POST", url: '/api/retrieval/profiles/' + id + '/search', payload: { query: "vu tru" } })).json()).toEqual({ matches: [], mode: "text" });
        await app.close();
    });
    it("sends OpenAI-compatible embeddings and restores response index ordering", async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 4 } }), { headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetch);
        const p = new OpenAiCompatibleProvider("openai", "fixture", "https://fixture.invalid/v1", undefined, "embed", 1000);
        expect(await p.embed({ model: "embed", texts: ["a", "b"] }, new AbortController().signal)).toEqual({ vectors: [[1, 0], [0, 1]], usage: { inputTokens: 4 } });
        expect(fetch.mock.calls[0]?.[0]).toBe("https://fixture.invalid/v1/embeddings");
    });
    it("uses Gemini's compatible endpoint for embedding, with auth in the header", async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), { headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetch);
        await new GeminiProvider("fixture", "gemini", 1000).embed({ model: "gemini-embedding-001", texts: ["a"] }, new AbortController().signal);
        expect(fetch.mock.calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/embeddings");
    });
    it("batches 32, records usage and filters embedding-incapable routes", async () => {
        const h = createPipelineHarness({ config: { LLM_ENABLE_MOCK: true } });
        harnesses.push(h);
        const registry = new LlmProviderRegistry(h.config);
        setEmbeddingRegistry(h.sqlite, registry);
        saveRetrievalSettings(h.sqlite, { embeddingProvider: "mock", embeddingModel: "mock-v1" });
        const spy = vi.spyOn(registry.get("mock")!, "embed");
        const result = await embedTexts(h.sqlite, Array.from({ length: 65 }, (_, i) => "fixture " + i));
        expect(result).toHaveLength(65);
        expect(spy.mock.calls.map(c => c[0].texts.length)).toEqual([32, 32, 1]);
        expect(h.sqlite.prepare("SELECT count(*) n FROM jobs WHERE scope='retrievalEmbed'").get()).toEqual({ n: 3 });
    });
});
