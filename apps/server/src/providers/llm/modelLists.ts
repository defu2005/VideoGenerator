import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Live model lists for providers that are not OpenAI-compatible.
// Every function returns [] on any failure; the caller then falls back to its static list.

const TIMEOUT_MS = 5_000;

async function getJson(url: string, fetchImpl: typeof fetch, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/** Anthropic API: GET /v1/models, newest first. */
export async function fetchAnthropicModels(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const payload = await getJson("https://api.anthropic.com/v1/models?limit=1000", fetchImpl, {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  }) as { data?: { id?: unknown }[] } | undefined;
  return (payload?.data ?? []).flatMap((item) => typeof item.id === "string" ? [item.id] : []);
}

/** Gemini API: models that support generateContent, without the "models/" prefix. */
export async function fetchGeminiModels(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const models: string[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    // The key goes in a header, not the URL, so it never shows up in logs.
    const payload = await getJson(url.toString(), fetchImpl, { "x-goog-api-key": apiKey }) as {
      models?: { name?: unknown; supportedGenerationMethods?: unknown }[];
      nextPageToken?: unknown;
    } | undefined;
    if (!payload) break;
    for (const model of payload.models ?? []) {
      const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
      if (typeof model.name === "string" && methods.includes("generateContent")) {
        models.push(model.name.replace(/^models\//, ""));
      }
    }
    if (typeof payload.nextPageToken !== "string" || !payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }
  return models;
}

/**
 * Copilot CLI has no "list models" command. Each session it runs records the models the
 * signed-in account may use ("availableModels") in ~/.copilot/session-state/<id>/events.jsonl.
 * Read the newest sessions and return the most recent list. Read-only; no credentials involved.
 */
export async function readCopilotAccountModels(copilotHome = join(homedir(), ".copilot"), maxSessions = 10): Promise<string[]> {
  const stateDir = join(copilotHome, "session-state");
  let sessions: { file: string; mtime: number }[];
  try {
    const names = await readdir(stateDir);
    sessions = (await Promise.all(names.map(async (name) => {
      const file = join(stateDir, name, "events.jsonl");
      try {
        return { file, mtime: (await stat(file)).mtimeMs };
      } catch {
        return undefined;
      }
    }))).filter((item): item is { file: string; mtime: number } => Boolean(item));
  } catch {
    return [];
  }
  sessions.sort((a, b) => b.mtime - a.mtime);
  const pattern = /"availableModels":(\[[^\]]*\])/g;
  for (const { file } of sessions.slice(0, maxSessions)) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    let last: string | undefined;
    for (const match of text.matchAll(pattern)) last = match[1];
    if (!last) continue;
    try {
      const parsed = JSON.parse(last) as unknown;
      if (Array.isArray(parsed)) {
        const models = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
        if (models.length > 0) return models;
      }
    } catch {
      continue;
    }
  }
  return [];
}
