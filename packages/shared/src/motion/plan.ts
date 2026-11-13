import {
  motionTemplate,
  normalizeBarValues,
  truncateMotionText,
  type MotionGraphicsSettings,
  type MotionTemplateId,
  type TimelineGraphic,
} from "./templates.js";
import type { EditPresetId } from "../edit/plan.js";
import type { FormatRecipe } from "../formats/recipes.js";

const FREQUENCY: Record<EditPresetId, number> = {
  calm: 20,
  energetic: 8,
  news: 10,
  story: 15,
};

export type MotionScene = {
  sceneId: string;
  startSec: number;
  durationSec: number;
  label: string;
  narration?: string;
  placeholder?: boolean;
  hook?: boolean;
  sectionKey?: string;
};

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** SHA-256 hex. Pure JS so the web bundle does not import node:crypto. */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 9 + 63) >> 6) << 6));
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const earlier = words[index - 15] ?? 0;
      const recent = words[index - 2] ?? 0;
      const small = rotateRight(earlier, 7) ^ rotateRight(earlier, 18) ^ (earlier >>> 3);
      const large = rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10);
      words[index] = ((words[index - 16] ?? 0) + small + (words[index - 7] ?? 0) + large) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + upper + choose + (k[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const lower = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (lower + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function motionCacheKey(input: {
  templateId: string;
  version: number;
  variables: Record<string, string | number>;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  hyperframesVersion: string;
}): string {
  return sha256Hex(JSON.stringify(input));
}

export function motionTelemetryEnv(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...base,
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
  };
}

/** Flags taken from `hyperframes render --help` v0.9.14. Windows uses webm alpha. */
export function motionRenderArgs(input: {
  workDir: string;
  outputPath: string;
  variablesFile: string;
  fps: number;
  workers: number;
  platform?: NodeJS.Platform;
}): { args: string[]; format: "webm" | "mov" } {
  const format = (input.platform ?? process.platform) === "win32" ? "webm" : "mov";
  const args = [
    "render",
    input.workDir,
    "--output", input.outputPath,
    "--format", format,
    "--fps", String(input.fps),
    "--workers", String(input.workers),
    "--variables-file", input.variablesFile,
    "--quality", "draft",
  ];
  if (format === "webm") args.push("--experimental-fast-capture=false");
  return { format, args };
}

export function clampGraphics(input: {
  graphics: TimelineGraphic[];
  totalDurationSec: number;
  scenes: MotionScene[];
  allowed?: MotionTemplateId[];
}): { graphics: TimelineGraphic[]; dropped: string[] } {
  const allowed = new Set(input.allowed ?? []);
  const scenes = new Map(input.scenes.map((scene) => [scene.sceneId, scene]));
  const kept: TimelineGraphic[] = [];
  const dropped: string[] = [];
  for (const graphic of input.graphics) {
    const spec = motionTemplate(graphic.templateId);
    if (!spec || (allowed.size > 0 && !allowed.has(graphic.templateId))) {
      dropped.push(graphic.templateId);
      continue;
    }
    if (graphic.layer === "fullscreen") {
      const scene = graphic.sceneId ? scenes.get(graphic.sceneId) : undefined;
      if (!scene?.placeholder) {
        dropped.push(graphic.id);
        continue;
      }
    }
    const durationSec = Math.min(spec.maxDurationSec, Math.max(spec.minDurationSec, graphic.durationSec));
    const startSec = Math.max(0, Math.min(graphic.startSec, Math.max(0, input.totalDurationSec - 0.1)));
    const end = Math.min(input.totalDurationSec, startSec + durationSec);
    if (end - startSec < spec.minDurationSec && spec.id !== "progress_bar") {
      dropped.push(graphic.id);
      continue;
    }
    const variables: Record<string, string | number> = {};
    for (const variable of spec.variables) {
      const raw = graphic.variables[variable.name] ?? variable.default;
      if (variable.type === "number") variables[variable.name] = Number(raw) || 0;
      else if (variable.maxLength) variables[variable.name] = truncateMotionText(String(raw), variable.maxLength);
      else variables[variable.name] = String(raw);
    }
    if (graphic.templateId === "bar_chart" && typeof variables.values === "string") {
      variables.values = normalizeBarValues(variables.values).join(",");
    }
    const next = { ...graphic, startSec, durationSec: Math.max(0.1, end - startSec), variables };
    const clash = kept.some((other) => {
      const otherSpec = motionTemplate(other.templateId);
      if (!otherSpec || otherSpec.safeArea !== spec.safeArea || other.layer !== "overlay" || next.layer !== "overlay") return false;
      const a0 = other.startSec;
      const a1 = other.startSec + other.durationSec;
      const b0 = next.startSec;
      const b1 = next.startSec + next.durationSec;
      return b0 < a1 && b1 > a0;
    });
    if (clash) {
      dropped.push(graphic.id);
      continue;
    }
    kept.push(next);
  }
  return { graphics: kept, dropped };
}

const NUMBER_RE = /(\d+(?:[.,]\d+)?)\s*(%|tỷ|triệu|nghìn)?/iu;
const LIST_RE = /^(thứ nhất|thứ hai|thứ ba|số\s*\d+|#\d+)/i;

export function fallbackGraphics(input: {
  title: string;
  aspect: "16:9" | "9:16" | "1:1";
  totalDurationSec: number;
  preset: EditPresetId;
  scenes: MotionScene[];
  settings?: Partial<MotionGraphicsSettings>;
  channelName?: string;
  recipe?: FormatRecipe;
}): TimelineGraphic[] {
  const every = FREQUENCY[input.preset];
  const accent = input.settings?.accentColor ?? "#F5C518";
  const drafts: TimelineGraphic[] = [];
  const hook = input.scenes.find((scene) => scene.hook) ?? input.scenes[0];
  if (hook) {
    drafts.push({
      id: `g-title-${hook.sceneId}`,
      templateId: "title_card",
      sceneId: hook.sceneId,
      startSec: hook.startSec,
      durationSec: 3,
      variables: { title: input.title, subtitle: hook.label, color: accent },
      layer: "overlay",
      source: "fallback",
    });
  }
  let lastNumber = -Infinity;
  for (const scene of input.scenes) {
    const text = `${scene.label} ${scene.narration ?? ""}`;
    const match = text.match(NUMBER_RE);
    if (match && scene.startSec - lastNumber >= 15) {
      drafts.push({
        id: `g-num-${scene.sceneId}`,
        templateId: "number_counter",
        sceneId: scene.sceneId,
        startSec: scene.startSec + 0.4,
        durationSec: 2.5,
        variables: { value: Number(match[1].replace(",", ".")) || 0, prefix: "", suffix: match[2] ?? "", label: scene.label, color: accent },
        layer: "overlay",
        source: "fallback",
      });
      lastNumber = scene.startSec;
    }
    for (const hint of input.recipe?.edit.graphics ?? []) {
      if (!scene.sectionKey || hint.sectionKey !== scene.sectionKey) continue;
      drafts.push({
        id: `g-recipe-${hint.templateId}-${scene.sceneId}`,
        templateId: hint.templateId,
        sceneId: scene.sceneId,
        startSec: scene.startSec,
        durationSec: 3,
        variables: { title: scene.label, badge: "#1", text: scene.label, color: accent },
        layer: "overlay",
        source: "fallback",
      });
    }
    if (LIST_RE.test(scene.label.trim())) {
      drafts.push({
        id: `g-list-${scene.sceneId}`,
        templateId: "list_item",
        sceneId: scene.sceneId,
        startSec: scene.startSec,
        durationSec: 3,
        variables: { badge: scene.label.split(/\s+/).slice(0, 2).join(" ").slice(0, 8), title: scene.label, color: accent },
        layer: "overlay",
        source: "fallback",
      });
    }
  }
  if (input.aspect === "9:16") {
    drafts.push({
      id: "g-progress",
      templateId: "progress_bar",
      sceneId: null,
      startSec: 0,
      durationSec: input.totalDurationSec,
      variables: { color: accent },
      layer: "overlay",
      source: "fallback",
    });
  }
  if (input.totalDurationSec >= 30 && input.settings?.endCard !== false) {
    const last = input.scenes[input.scenes.length - 1];
    drafts.push({
      id: "g-end",
      templateId: "end_card",
      sceneId: last?.sceneId ?? null,
      startSec: Math.max(0, input.totalDurationSec - 3),
      durationSec: 3,
      variables: { line: "Theo dõi để xem thêm", channel: input.channelName ?? input.settings?.channelName ?? "", color: "#F8FAFC" },
      layer: last?.placeholder ? "fullscreen" : "overlay",
      source: "fallback",
    });
  }
  const spaced: TimelineGraphic[] = [];
  for (const graphic of drafts) {
    if (graphic.templateId === "progress_bar" || graphic.templateId === "end_card") {
      spaced.push(graphic);
      continue;
    }
    const previous = [...spaced].reverse().find((item) => item.templateId !== "progress_bar");
    if (previous && graphic.startSec - previous.startSec < every && graphic.templateId !== "title_card" && !graphic.id.startsWith("g-recipe-")) continue;
    spaced.push(graphic);
  }
  return clampGraphics({
    graphics: spaced,
    totalDurationSec: input.totalDurationSec,
    scenes: input.scenes,
    allowed: input.settings?.templates,
  }).graphics;
}

export type OverlayClip = { id: string; startSec: number; endSec: number; inputIndex: number };

/** Overlay after the picture and before subtitles. Groups of 12. */
export function buildOverlayFilter(clips: OverlayClip[], baseLabel = "[base]"): { filter: string; groups: number; videoMap: string } {
  if (clips.length === 0) return { filter: "", groups: 0, videoMap: baseLabel };
  const groups: string[] = [];
  let current = baseLabel;
  const groupCount = Math.ceil(clips.length / 12);
  clips.forEach((clip, index) => {
    const shifted = `[og${index}]`;
    const out = index === clips.length - 1 ? "[ovout]" : `[ov${index}]`;
    groups.push(
      `[${clip.inputIndex}:v]setpts=PTS-STARTPTS+${clip.startSec}/TB${shifted}`,
      `${current}${shifted}overlay=0:0:enable='between(t,${clip.startSec},${clip.endSec})':format=auto${out}`,
    );
    current = out;
  });
  return { filter: groups.join(";"), groups: groupCount, videoMap: "[ovout]" };
}

export function emphasisAfterGraphicFailure(effects: ("punch_in" | "callout" | "flash" | "sfx")[], failedKinetic: boolean): ("punch_in" | "callout" | "flash" | "sfx")[] {
  const withoutCallout = effects.filter((effect) => effect !== "callout");
  if (!failedKinetic) return withoutCallout;
  return effects.includes("callout") ? effects : [...effects, "callout"];
}

export function overlayWithinFrame(startSec: number, timelineStart: number, fps: number): boolean {
  return Math.abs(startSec - timelineStart) < 1 / fps;
}
