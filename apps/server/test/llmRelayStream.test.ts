import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmRelay, type RelayDeps } from "../src/providers/llm/relay.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { RelayStreamRedactor } from "../src/providers/llm/relayStream.js";

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));
const secret = "server-only-key-123456789";
const caller = { caller: "node:test-node", workspaceId: "A", label: "Fixture", nodeId: "test-node" };

function setup(chunks: string[], overrides: Partial<RelayDeps> = {}) {
  const fixture = createPipelineHarness(); fixtures.push(fixture);
  const fetchImpl = vi.fn(async (_url: unknown, _options: RequestInit | undefined) => new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } }));
  const relay = new LlmRelay({ sqlite: fixture.sqlite,
    config: { ...fixture.config, OMNIROUTE_API_KEY: secret, OMNIROUTE_BASE_URL: "http://fixture.invalid/v1",
      LLM_PRICES_JSON: JSON.stringify({ "omniroute:fixture": { inputPerMTok: 0, outputPerMTok: 0 } }) },
    catalog: { getModels: async () => [{ id: "fixture", ownedBy: "fixture" }] } as unknown as RelayDeps["catalog"],
    quota: () => null, verifyApiKey: async () => ({ valid: false }), authenticateNode: () => undefined,
    now: fixture.clock, fetchImpl: fetchImpl as typeof fetch, ...overrides,
  });
  return { ...fixture, relay, fetchImpl };
}

describe("relay streaming and admission boundaries", () => {
  it("denies browser sessions, revoked nodes and API keys without an agent profile", async () => {
    const h = setup([], { verifyApiKey: async () => ({ valid: true, keyId: "unprofiled" }) });
    await expect(h.relay.authenticate({ cookie: "session=fixture" })).rejects.toMatchObject({ status: 403 });
    await expect(h.relay.authenticate({ authorization: "Bearer vgn_revoked" })).rejects.toMatchObject({ status: 403 });
    await expect(h.relay.authenticate({ authorization: "Bearer unprofiled-key" })).rejects.toMatchObject({ status: 403 });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards only server-owned headers and records upstream JSON usage", async () => {
    const h = setup([]);
    h.fetchImpl.mockResolvedValue(Response.json({ choices: [{ message: { content: "fixture response" } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 } }));
    const result = await h.relay.relay("chat/completions", caller, { model: "fixture", messages: [] });
    expect(result.status).toBe(200);
    expect(h.fetchImpl.mock.calls[0]![1]!.headers).toEqual({
      "content-type": "application/json", accept: "application/json", authorization: `Bearer ${secret}`,
    });
    expect(String(result.body)).not.toContain(secret);
    expect(h.sqlite.prepare("SELECT input_tokens,output_tokens,estimated FROM llm_relay_usage").get())
      .toEqual({ input_tokens: 20, output_tokens: 5, estimated: 0 });
  });

  it("emits SSE before the upstream closes", async () => {
    const h = setup([]);
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    h.fetchImpl.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } }),
      { headers: { "content-type": "text/event-stream" } }));
    const result = await h.relay.relay("chat/completions", caller, { model: "fixture", stream: true, messages: [] });
    if (typeof result.body === "string") throw new Error("Expected a stream");
    const iterator = result.body[Symbol.asyncIterator]();
    upstream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "x".repeat(100) } }] })}\n\n`));
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(String(first.value)).toContain("data:");
    upstream.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); upstream.close();
    while (!(await iterator.next()).done) { /* drain before fixture database closes */ }
  });

  it("passes cancellation to an already-aborted upstream request", async () => {
    const h = setup([]), controller = new AbortController(); controller.abort();
    let forwardedSignal: AbortSignal | null | undefined;
    h.fetchImpl.mockImplementation(async (_url, options) => {
      forwardedSignal = options?.signal;
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(h.relay.relay("chat/completions", caller, { model: "fixture", messages: [] }, { signal: controller.signal }))
      .rejects.toMatchObject({ status: 503, code: "LLM_RELAY_UNAVAILABLE" });
    expect(forwardedSignal?.aborted).toBe(true);
  });
  it("preserves Unicode text at every transport boundary while redacting repeated keys", () => {
    const input = `Tiếng Việt 🌟 ${secret} 🌙 ${secret} hoàn tất`;
    for (let split = 0; split <= input.length; split++) {
      const redactor = new RelayStreamRedactor([secret]);
      const chunks = [redactor.push(input.slice(0, split)), redactor.push(input.slice(split)), redactor.push("", true)];
      // Each emitted chunk is independently encoded to UTF-8 by the production SSE pump.
      expect(chunks.map((chunk) => Buffer.from(chunk).toString()).join(""))
        .toBe(input.replaceAll(secret, "[đã ẩn]"));
    }
  });
  it.each([1, 7, secret.length - 1])("redacts the server key split at offset %i while retaining final SSE usage", async (split) => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: secret } }] })}\n\n`;
    const offset = sse.indexOf(secret) + split;
    const usage = 'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}\n\n';
    const h = setup([sse.slice(0, offset), sse.slice(offset), usage, "data: [DONE]\n\n"]);
    const result = await h.relay.relay("chat/completions", caller, { model: "fixture", stream: true, messages: [] });
    let output = "";
    if (typeof result.body === "string") throw new Error("Expected a stream");
    for await (const chunk of result.body) output += String(chunk);
    expect(output).not.toContain(secret);
    expect(output).toContain("[đã ẩn]");
    expect(output).toContain("data: [DONE]");
    expect(h.sqlite.prepare("SELECT input_tokens,output_tokens,estimated FROM llm_relay_usage").get())
      .toEqual({ input_tokens: 12, output_tokens: 8, estimated: 0 });
    const forwarded = JSON.parse(String(h.fetchImpl.mock.calls[0]![1]!.body));
    expect(forwarded.stream_options.include_usage).toBe(true);
  });

  it("rejects the very first request if its input exceeds the token-per-minute cap", async () => {
    const h = setup([]);
    h.relay.saveGrant(caller.caller, { tpm: 100 }, caller.workspaceId);
    await expect(h.relay.relay("chat/completions", caller,
      { model: "fixture", messages: [{ role: "user", content: "x".repeat(1000) }] }))
      .rejects.toMatchObject({ status: 429, code: "RELAY_RATE_LIMITED" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
});
