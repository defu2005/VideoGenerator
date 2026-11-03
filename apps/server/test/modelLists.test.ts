import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/lib/config.js";
import { fetchAnthropicModels, fetchGeminiModels, readCopilotAccountModels } from "../src/providers/llm/modelLists.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function copilotHome(sessions: { id: string; lines: string[]; ageMs: number }[]): string {
  const home = mkdtempSync(join(tmpdir(), "copilot-home-"));
  dirs.push(home);
  for (const session of sessions) {
    const dir = join(home, "session-state", session.id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "events.jsonl");
    writeFileSync(file, session.lines.join("\n"));
    const time = new Date(Date.now() - session.ageMs);
    utimesSync(file, time, time);
  }
  return home;
}

describe("live model lists", () => {
  it("lists every Anthropic model from /v1/models with the key in headers", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5-5" }, { id: 3 }] })) as unknown as typeof fetch;
    expect(await fetchAnthropicModels("sk-test", fetchImpl)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(init?.headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" });
  });

  it("lists Gemini models that can generate text, across pages, without the key in the URL", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({
        models: [
          { name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        ],
        nextPageToken: "p2",
      }))
      .mockResolvedValueOnce(json({ models: [{ name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent", "countTokens"] }] })) as unknown as typeof fetch;
    expect(await fetchGeminiModels("g-secret", fetchImpl)).toEqual(["gemini-3-pro", "gemini-3-flash"]);
    const urls = vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url));
    expect(urls[1]).toContain("pageToken=p2");
    expect(urls.join(" ")).not.toContain("g-secret");
  });

  it("returns [] when the provider answers with an error", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "bad key" }, 401)) as unknown as typeof fetch;
    expect(await fetchAnthropicModels("bad", fetchImpl)).toEqual([]);
    expect(await fetchGeminiModels("bad", fetchImpl)).toEqual([]);
  });

  it("reads the newest Copilot account model list from session logs", async () => {
    const home = copilotHome([
      { id: "old", ageMs: 60_000, lines: ['{"data":{"availableModels":["gpt-6-luna"]}}'] },
      { id: "new", ageMs: 1_000, lines: [
        '{"data":{"availableModels":["gpt-6-luna"]}}',
        '{"data":{"availableModels":["mai-code-1.1-flash","gpt-5.4"]}}',
      ] },
      { id: "newest-without-list", ageMs: 0, lines: ['{"type":"user.message"}'] },
    ]);
    expect(await readCopilotAccountModels(home)).toEqual(["mai-code-1.1-flash", "gpt-5.4"]);
  });

  it("returns [] when Copilot has never run", async () => {
    expect(await readCopilotAccountModels(join(tmpdir(), "no-copilot-here-xyz"))).toEqual([]);
  });
});

describe("registry model suggestions", () => {
  it("puts the live Anthropic list first and keeps the static list as a fallback", async () => {
    const registry = new LlmProviderRegistry(parseConfig({ LLM_ENABLE_MOCK: "false", ANTHROPIC_API_KEY: "sk-test" }));
    const fetchImpl = vi.fn(async () => json({ data: [{ id: "claude-brand-new-9" }] })) as unknown as typeof fetch;
    const models = await registry.suggestModels("anthropic", fetchImpl);
    expect(models).toContain("claude-brand-new-9");
    expect(models.indexOf("claude-brand-new-9")).toBeLessThan(models.indexOf("claude-opus-4-5"));
  });

  it("offers auto plus the account's Copilot models", async () => {
    const home = copilotHome([{ id: "s", ageMs: 0, lines: ['{"availableModels":["mai-code-1.1-flash"]}'] }]);
    const registry = new LlmProviderRegistry(
      parseConfig({ LLM_ENABLE_MOCK: "false", COPILOT_CLI_ENABLED: "true", COPILOT_CLI_PATH: process.execPath }),
      { copilotHome: home },
    );
    const models = await registry.suggestModels("copilot-cli", vi.fn() as unknown as typeof fetch);
    expect(models).toEqual(expect.arrayContaining(["auto", "mai-code-1.1-flash"]));
    expect(models).not.toContain("gpt-6-luna");
  });

  it("sends the API key when listing Groq models", async () => {
    const registry = new LlmProviderRegistry(parseConfig({ LLM_ENABLE_MOCK: "false", GROQ_API_KEY: "groq-secret" }));
    const fetchImpl = vi.fn(async () => json({ data: [{ id: "llama-9" }] })) as unknown as typeof fetch;
    expect(await registry.suggestModels("groq", fetchImpl)).toContain("llama-9");
    expect(vi.mocked(fetchImpl).mock.calls[0]![1]?.headers).toEqual({ Authorization: "Bearer groq-secret" });
  });
});
