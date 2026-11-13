import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import {
  TtsAppSettingsSchema,
  type MediaBundle,
  type MediaReport,
  type TtsAppSettings,
  type TtsBundle,
  type VoiceResult,
} from "@vg/shared";
import { parseConfig, type AppConfig } from "../lib/config.js";
import { TtsProviderRegistry } from "../providers/tts/registry.js";

/*
 * The parts of a worker node that run VOICE and MEDIA_FETCH jobs (TASK-120). No database, no vault, no .env:
 * the only key a node ever holds is the one the control plane lent for this lease, in memory, wiped after use.
 */

/** A key held in memory only. `wipe()` overwrites the bytes. Nothing here is ever logged or written to disk. */
export class SecretHolder {
  private bytes: Buffer | null;
  constructor(bytes: Buffer, readonly scope: string, readonly expiresAt: string) {
    this.bytes = bytes;
  }

  get(): string | null {
    return this.bytes ? this.bytes.toString("utf8") : null;
  }

  expired(now = Date.now()): boolean {
    return Date.parse(this.expiresAt) <= now;
  }

  wipe(): void {
    this.bytes?.fill(0);
    this.bytes = null;
  }
}

/** Settings for the providers on this node. Optional JSON in `VG_NODE_TTS_SETTINGS` (model folders, command templates). */
export function nodeTtsSettings(env: Record<string, string | undefined>): TtsAppSettings {
  let extra: Record<string, unknown> = {};
  try {
    if (env.VG_NODE_TTS_SETTINGS) extra = JSON.parse(env.VG_NODE_TTS_SETTINGS) as Record<string, unknown>;
  } catch {
    extra = {};
  }
  const parsed = TtsAppSettingsSchema.safeParse({ defaultProvider: "mock", ...extra });
  return parsed.success ? parsed.data : TtsAppSettingsSchema.parse({ defaultProvider: "mock" });
}

export function nodeConfig(env: Record<string, string | undefined>): AppConfig {
  try {
    return parseConfig(env as NodeJS.ProcessEnv);
  } catch {
    return parseConfig({} as NodeJS.ProcessEnv);
  }
}

export function createNodeTtsRegistry(
  env: Record<string, string | undefined>,
  secret: () => { scope: string; value: string | null } | null,
  deps: { fetchImpl?: typeof fetch } = {},
): TtsProviderRegistry {
  const settings = nodeTtsSettings(env);
  return new TtsProviderRegistry(nodeConfig(env), {
    settings: () => settings,
    secret: (id) => {
      const held = secret();
      return held && held.scope === `tts:${id}` ? held.value : null;
    },
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/**
 * Which `tts:<provider>` capabilities this node declares. CLI providers (piper, vieneu, edge-tts) only when the tool is really there.
 * Key-based providers are never detected: the operator lists them in `VG_NODE_TTS` (the node holds no key, it is lent one per job).
 */
export function detectTtsCapabilities(env: Record<string, string | undefined>, registry: TtsProviderRegistry): string[] {
  const out = new Set<string>();
  for (const id of ["piper", "vieneu", "edge-tts"]) if (registry.get(id)?.isAvailable()) out.add(`tts:${id}`);
  for (const raw of (env.VG_NODE_TTS ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (/^[a-z0-9_-]{2,30}$/.test(id) && registry.get(id)) out.add(`tts:${id}`);
  }
  return [...out].sort();
}

export type VoiceRunInput = {
  bundle: TtsBundle;
  workDir: string;
  registry: TtsProviderRegistry;
  signal: AbortSignal;
  onProgress: (pct: number, message: string) => void;
};

/** Synthesize every scene of the bundle with exactly the planned provider (no fallback) and write `audio/<id>.<ext>` plus the result. */
export async function runVoiceBundle(input: VoiceRunInput): Promise<{ result: VoiceResult; files: Array<{ name: string; path: string }> }> {
  const { bundle } = input;
  const audioDir = join(input.workDir, "audio");
  mkdirSync(audioDir, { recursive: true });
  const scenes: VoiceResult["scenes"] = [];
  const files: Array<{ name: string; path: string }> = [];
  for (const [index, scene] of bundle.scenes.entries()) {
    if (input.signal.aborted) throw new Error("Đã hủy.");
    const outPath = join(audioDir, `${scene.sceneId}.mp3`);
    const made = await input.registry.synthesizeSingle({
      providerId: bundle.provider,
      text: scene.text,
      language: bundle.language,
      outPath,
      signal: input.signal,
      voice: bundle.voice,
      rate: bundle.rate,
      ...(bundle.model ? { model: bundle.model } : {}),
      ...(bundle.style ? { style: bundle.style } : {}),
    });
    const ext = extname(made.audioPath).toLowerCase() === ".wav" ? "wav" : "mp3";
    const name = `audio/${scene.sceneId}.${ext}`;
    scenes.push({
      sceneId: scene.sceneId,
      hash: scene.hash,
      file: name,
      provider: made.providerId,
      voice: made.voice,
      rate: made.rate,
      durationSec: made.durationSec,
      cues: made.cues,
      ...(made.words ? { words: made.words } : {}),
      timingSource: made.timingSource,
      characters: made.characters,
      ...(made.costUsd !== undefined ? { costUsd: made.costUsd } : {}),
    });
    files.push({ name, path: made.audioPath });
    input.onProgress(Math.round(((index + 1) / bundle.scenes.length) * 90), `Tạo giọng cảnh ${index + 1}/${bundle.scenes.length}`);
  }
  const result: VoiceResult = { scenes };
  const resultPath = join(input.workDir, "result.json");
  writeFileSync(resultPath, JSON.stringify(result));
  files.push({ name: "result.json", path: resultPath });
  return { result, files };
}

export type MediaRunInput = {
  bundle: MediaBundle;
  workDir: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  onProgress: (pct: number, message: string) => void;
};

/** Download each public file URL into the work dir, under the size cap. A failed item is reported as skipped, not as a job failure. */
export async function runMediaBundle(input: MediaRunInput): Promise<{ report: MediaReport; files: Array<{ name: string; path: string }> }> {
  const { bundle } = input;
  const fetched: MediaReport["fetched"] = [];
  const skipped: MediaReport["skipped"] = [];
  const files: Array<{ name: string; path: string }> = [];
  for (const [index, item] of bundle.items.entries()) {
    if (input.signal.aborted) throw new Error("Đã hủy.");
    const target = join(input.workDir, item.target);
    try {
      if (!item.url.startsWith("https://")) throw new Error("Địa chỉ tệp phải là https.");
      mkdirSync(dirname(target), { recursive: true });
      const sha256 = await downloadCapped(input.fetchImpl, item.url, target, bundle.maxBytes, input.signal);
      fetched.push({ target: item.target, sha256, size: statSync(target).size });
      files.push({ name: item.target, path: target });
    } catch (error) {
      rmSync(target, { force: true });
      if (input.signal.aborted) throw error;
      skipped.push({ target: item.target, reason: (error instanceof Error ? error.message : "lỗi").slice(0, 280) });
    }
    input.onProgress(Math.round(((index + 1) / bundle.items.length) * 90), `Tải clip ${index + 1}/${bundle.items.length}`);
  }
  const report: MediaReport = { fetched, skipped };
  const reportPath = join(input.workDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report));
  files.push({ name: "report.json", path: reportPath });
  return { report, files };
}

async function downloadCapped(fetchImpl: typeof fetch, url: string, target: string, maxBytes: number, signal: AbortSignal): Promise<string> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok || !response.body) throw new Error(`Tải lỗi (${response.status})`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Tệp lớn hơn giới hạn.");
  const hash = createHash("sha256");
  const part = `${target}.part`;
  const out = createWriteStream(part);
  let total = 0;
  try {
    for await (const chunk of Readable.fromWeb(response.body as never)) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) throw new Error("Tệp lớn hơn giới hạn.");
      hash.update(chunk as Buffer);
      if (!out.write(chunk)) await new Promise<void>((done) => out.once("drain", () => done()));
    }
    await new Promise<void>((done, fail) => out.end((error?: Error | null) => (error ? fail(error) : done())));
  } catch (error) {
    out.destroy();
    rmSync(part, { force: true });
    throw error;
  }
  if (total === 0) {
    rmSync(part, { force: true });
    throw new Error("Tệp rỗng.");
  }
  rmSync(target, { force: true });
  renameSync(part, target);
  return hash.digest("hex");
}

