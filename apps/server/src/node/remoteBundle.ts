import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { MediaBundleSchema, RenderBundleSchema, TtsBundleSchema, type ArtifactRef, type MediaBundle, type RenderBundle, type TtsBundle } from "@vg/shared";
import type { ArtifactService } from "./artifactService.js";

const ABSOLUTE = /^(?:[A-Za-z]:[\/]|\\|\/)/;

function looksLikePath(text: string): boolean {
  return text.length > 1 && text.length < 1024 && !text.includes("\n") && (ABSOLUTE.test(text) || text.includes("/") || text.includes("\\") || /\.[A-Za-z0-9]{2,5}$/.test(text));
}

/** Names the worker maps to its cache. Never a path from the main machine. */
export function logicalName(sha256: string, source: string): string {
  const ext = extname(source).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
  return `files/${sha256.slice(0, 16)}${ext}`;
}

export class RemoteBundleError extends Error {}

/**
 * Copy of a bundle for a worker: every file path becomes `files/<hash>.<ext>` and the files are listed
 * by hash. Fails (so the job stays local) when a path to the main machine would be left in it.
 */
export async function buildRemoteBundle(
  bundle: RenderBundle,
  resolvePath: (name: string) => string,
  artifacts: ArtifactService,
): Promise<{ bundle: RenderBundle; files: ArtifactRef[] }> {
  const files = new Map<string, ArtifactRef>();
  const replaced = new Map<string, string>();
  const pending: Array<{ text: string; path: string }> = [];
  const visit = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      if (key === "creditsText" || key === "assText") return;
      if (looksLikePath(value) && !replaced.has(value)) {
        const path = resolvePath(value);
        if (existsSync(path) && statSync(path).isFile()) {
          replaced.set(value, path);
          pending.push({ text: value, path });
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
    } else if (value && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) visit(item, name);
    }
  };
  const base: RenderBundle = { ...bundle, timeline: { ...bundle.timeline, subtitles: null } };
  visit(base, "");
  const logical = new Map<string, string>();
  for (const { text, path } of pending) {
    const { sha256, size } = await artifacts.register(path);
    const name = logicalName(sha256, path);
    logical.set(text, name);
    files.set(sha256, { name, sha256, size });
  }
  const rewrite = (value: unknown, key: string): unknown => {
    if (typeof value === "string") return key === "creditsText" || key === "assText" ? value : logical.get(value) ?? value;
    if (Array.isArray(value)) return value.map((item) => rewrite(item, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, rewrite(item, name)]));
    }
    return value;
  };
  const rewritten = rewrite(base, "") as RenderBundle;
  rewritten.files = [...files.values()];
  const checked = RenderBundleSchema.parse(rewritten);
  const leaks: string[] = [];
  const scan = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      if (key !== "creditsText" && key !== "assText" && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || /^\/[^\s]{2,}$/.test(value))) leaks.push(value.slice(0, 40));
    } else if (Array.isArray(value)) value.forEach((item) => scan(item, key));
    else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) scan(item, name);
  };
  scan(checked, "");
  if (leaks.length) throw new RemoteBundleError(`Bundle còn đường dẫn nội bộ: ${leaks.slice(0, 3).join(", ")}`);
  return { bundle: checked, files: checked.files };
}

/**
 * TASK-120: the bundle of a VOICE job. Scene texts and the voice choice, nothing else: no key, no path.
 * The strict schema is what keeps anything extra out.
 */
export function buildTtsBundle(input: {
  provider: string;
  voice: string;
  rate: string;
  model?: string;
  style?: string;
  language: string;
  wordTimings: boolean;
  scenes: Array<{ sceneId: string; hash: string; text: string }>;
}): TtsBundle {
  return TtsBundleSchema.parse({
    kind: "tts",
    provider: input.provider,
    voice: input.voice,
    rate: input.rate,
    ...(input.model ? { model: input.model } : {}),
    ...(input.style ? { style: input.style } : {}),
    language: input.language,
    timingMode: input.wordTimings ? "provider" : "aligned",
    scenes: input.scenes,
  });
}

/** One stock clip a node should fetch. `files` are the candidate renditions of the hit. */
export type MediaItemInput = {
  provider: "pexels" | "pixabay";
  clipId: string;
  url: string;
  width: number;
  height: number;
  durationSec: number;
  bytes?: number;
  author: string;
  licenseName: string;
  pageUrl: string;
};

/** The upload name a fetched clip must have; it is also the control plane's footage cache name. */
export function mediaTargetName(item: Pick<MediaItemInput, "provider" | "clipId" | "height">): string {
  const id = item.clipId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `media/${item.provider}-${id}-${item.height}.mp4`;
}

/** The bundle of a MEDIA_FETCH job: public file URLs, the licence record of each, and where to put the result. */
export function buildMediaBundle(items: MediaItemInput[], targetShortSide: number, maxBytes: number): MediaBundle {
  return MediaBundleSchema.parse({
    kind: "media",
    targetShortSide,
    maxBytes,
    items: items.map((item) => ({
      provider: item.provider,
      clipId: item.clipId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
      url: item.url,
      width: item.width,
      height: item.height,
      durationSec: item.durationSec,
      ...(item.bytes !== undefined ? { bytes: item.bytes } : {}),
      target: mediaTargetName(item),
      licence: { name: item.licenseName.slice(0, 200), author: item.author.slice(0, 200), pageUrl: item.pageUrl.slice(0, 2000) },
    })),
  });
}
