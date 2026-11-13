import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { motionCacheKey, motionRenderArgs, motionTelemetryEnv, motionTemplate } from "@vg/shared";

const require = createRequire(import.meta.url);
const HYPERFRAMES_VERSION = "0.9.14";
const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function hyperframesEntry(): string {
  return join(dirname(require.resolve("hyperframes/package.json")), "bin", "hyperframes.mjs");
}

export function motionAssetRoot(): string {
  return join(serverRoot, "assets", "motion");
}

function fontFile(weight: "400" | "700"): string {
  return join(dirname(require.resolve("@fontsource/be-vietnam-pro/package.json")), "files", `be-vietnam-pro-vietnamese-${weight}-normal.woff2`);
}

export function gsapFile(): string {
  return join(dirname(require.resolve("gsap/package.json")), "dist", "gsap.min.js");
}

export function safeTemplateDir(templateId: string): string | null {
  if (!/^[a-z0-9_]+$/.test(templateId) || !motionTemplate(templateId)) return null;
  const root = resolve(motionAssetRoot());
  const dir = resolve(root, templateId);
  if (!dir.startsWith(root)) return null;
  return existsSync(join(dir, "index.html")) ? dir : null;
}

export function writeCompositionHtml(html: string, size: { width: number; height: number; fps: number; durationSec: number }): string {
  return html
    .replace(/data-duration="[^"]*"/, `data-duration="${size.durationSec}"`)
    .replace(/data-width="[^"]*"/, `data-width="${size.width}"`)
    .replace(/data-height="[^"]*"/, `data-height="${size.height}"`)
    .replace(/data-fps="[^"]*"/, `data-fps="${size.fps}"`);
}

export function prepareMotionFolder(input: {
  templateId: string;
  workDir: string;
  variables: Record<string, string | number>;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  workers: number;
  outputPath: string;
}): { args: string[]; env: NodeJS.ProcessEnv; format: "webm" | "mov" } {
  const source = safeTemplateDir(input.templateId);
  if (!source) throw new Error(`Không có mẫu ${input.templateId}`);
  mkdirSync(input.workDir, { recursive: true });
  const html = writeCompositionHtml(readFileSync(join(source, "index.html"), "utf8"), input);
  writeFileSync(join(input.workDir, "index.html"), html);
  writeFileSync(join(input.workDir, "variables.json"), JSON.stringify(input.variables));
  copyFileSync(gsapFile(), join(input.workDir, "gsap.min.js"));
  copyFileSync(fontFile("400"), join(input.workDir, "font.woff2"));
  copyFileSync(fontFile("700"), join(input.workDir, "font-bold.woff2"));
  const rendered = motionRenderArgs({
    workDir: input.workDir,
    outputPath: input.outputPath,
    variablesFile: join(input.workDir, "variables.json"),
    fps: input.fps,
    workers: input.workers,
  });
  return { ...rendered, env: motionTelemetryEnv(process.env) };
}

export function motionCachePath(dataDir: string, key: string, format: "webm" | "mov"): string {
  return join(dataDir, "cache", "motion", `${key}.${format}`);
}

export function pruneMotionCache(dataDir: string, maxBytes = 2 * 1024 * 1024 * 1024): void {
  const dir = join(dataDir, "cache", "motion");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).map((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    return { path, size: stat.size, mtime: stat.mtimeMs };
  }).sort((a, b) => a.mtime - b.mtime);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (total <= maxBytes) break;
    rmSync(file.path, { force: true });
    total -= file.size;
  }
}

let active = 0;
const waiters: (() => void)[] = [];

async function withSlot<T>(limit: number, run: () => Promise<T>): Promise<T> {
  if (active >= limit) await new Promise<void>((resolvePromise) => waiters.push(resolvePromise));
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

export function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

export type MotionRunResult = { outputPath: string; seconds: number; cached: boolean; warning?: string };

export async function renderMotionGraphic(input: {
  dataDir: string;
  templateId: string;
  variables: Record<string, string | number>;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  workers?: number;
  timeoutSec?: number;
  run?: (command: string, args: string[], env: NodeJS.ProcessEnv, outputPath: string) => Promise<void>;
}): Promise<MotionRunResult> {
  const spec = motionTemplate(input.templateId);
  if (!spec) return { outputPath: "", seconds: 0, cached: false, warning: `Bỏ đồ họa ${input.templateId}: mẫu không có.` };
  const format = process.platform === "win32" ? "webm" : "mov";
  const key = motionCacheKey({
    templateId: input.templateId,
    version: spec.version,
    variables: input.variables,
    width: input.width,
    height: input.height,
    fps: input.fps,
    durationSec: input.durationSec,
    hyperframesVersion: HYPERFRAMES_VERSION,
  });
  const outputPath = motionCachePath(input.dataDir, key, format);
  if (existsSync(outputPath)) return { outputPath, seconds: 0, cached: true };
  const workDir = join(input.dataDir, "cache", "motion", "work", key);
  const started = Date.now();
  try {
    const prepared = prepareMotionFolder({
      ...input,
      workDir,
      workers: input.workers ?? 2,
      outputPath,
    });
    mkdirSync(dirname(outputPath), { recursive: true });
    const command = process.execPath;
    const args = [hyperframesEntry(), ...prepared.args];
    await withSlot(2, () => (input.run ?? runHyperframes)(command, args, prepared.env, outputPath));
    return { outputPath, seconds: (Date.now() - started) / 1000, cached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "lỗi đồ họa";
    return { outputPath: "", seconds: (Date.now() - started) / 1000, cached: false, warning: `Bỏ ${input.templateId}: ${message}` };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function withMediaBins(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const bins: string[] = [];
  const ffmpeg = require("ffmpeg-static") as string | null;
  if (ffmpeg) bins.push(dirname(ffmpeg));
  const probe = require("ffprobe-static") as { path?: string };
  if (probe.path) bins.push(dirname(probe.path));
  const sep = process.platform === "win32" ? ";" : ":";
  const current = env.PATH ?? env.Path ?? process.env.PATH ?? "";
  const path = [...bins, current].filter(Boolean).join(sep);
  return { ...env, PATH: path, Path: path };
}

function runHyperframes(command: string, args: string[], env: NodeJS.ProcessEnv, _outputPath: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { env: withMediaBins(env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      rejectPromise(new Error("hết giờ render đồ họa"));
    }, 120_000);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); rejectPromise(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(stderr.trim().slice(-400) || `hyperframes thoát ${code}`));
    });
  });
}

export function inlineMotionPreview(templateId: string, variables: Record<string, string | number>): string | null {
  const dir = safeTemplateDir(templateId);
  if (!dir) return null;
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const gsap = readFileSync(gsapFile(), "utf8");
  const controls = `<div id="vg-preview-bar" style="position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;align-items:center;padding:8px;background:rgba(0,0,0,.55);z-index:9;color:#fff;font:14px sans-serif"><button type="button" id="vg-play">Phát</button><input id="vg-seek" type="range" min="0" max="1000" value="0" aria-label="Tua đồ họa" style="flex:1"></div><script>(function(){function timeline(){return window.__timelines&&window.__timelines.main}var play=document.getElementById("vg-play");var seek=document.getElementById("vg-seek");var root=document.querySelector("[data-duration]");var duration=root?Number(root.getAttribute("data-duration"))||3:3;play.addEventListener("click",function(){var tl=timeline();if(!tl)return;if(tl.paused()){tl.play();play.textContent="Tạm dừng"}else{tl.pause();play.textContent="Phát"}});seek.addEventListener("input",function(){var tl=timeline();if(!tl)return;tl.pause();play.textContent="Phát";tl.seek(duration*Number(seek.value)/1000)})})();</script>`;
  const body = html
    .replace(/<script src="gsap\.min\.js"><\/script>/, `<script>${gsap}</script>`)
    .replace("<body>", `<body><script>window.__hyperframes={getVariables:function(){return ${JSON.stringify(variables)};}};</script>`)
    .replace("</body>", `${controls}</body>`);
  return body;
}
