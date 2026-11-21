import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { presetMotion, PLACEHOLDER_COLOR, zoompanExprs, type RenderTarget, type Shot } from "@vg/shared";
import type { Browser, Page } from "puppeteer-core";
import { composeAssetRoot } from "../compose/hyperframes.js";
import { graphicVariables } from "../compose/render/graphicVars.js";
import { finishedSeekSec } from "../compose/render/graphic.js";
import { shotFrameCount, type ComposeRenderContext } from "../compose/render/context.js";
import { gsapFile, writeCompositionHtml } from "../media/motion.js";
import { probeDurationSec } from "../media/ffmpeg.js";
import { AppError } from "../lib/errors.js";
import { projectDir } from "../storage/paths.js";
import type { PreviewFfmpeg } from "./media.js";
import { measuredSafeArea, type SafeAreaResult } from "./facts.js";

const require = createRequire(import.meta.url);
const BASE = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
const CLIP = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-an"];
type Capture = { atSec: number; path: string };
export class PreviewAdapterUnavailable extends Error {}

/** TASK-139b timing. Off unless VG_PREVIEW_TIMING=1; one stderr line per stage, tagged with pid. */
const TIMING = process.env.VG_PREVIEW_TIMING === "1";
export function previewStage(label: string): (note?: string) => void {
  const started = performance.now();
  return (note) => {
    if (TIMING) process.stderr.write(`[preview-timing] pid=${process.pid} ${label} ${Math.round(performance.now() - started)}ms${note ? ` ${note}` : ""}\n`);
  };
}

function below(root: string, file: string): boolean {
  const path = relative(root, file);
  return Boolean(path) && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

/** Permit inline timeline images only from the selected project's managed directory. */
export function previewGraphicAsset(ctx: ComposeRenderContext, path: string): string {
  if (!ctx.projectId) throw new Error("Preview image has no project");
  const dataRoot = realpathSync(ctx.dataDir);
  const root = projectDir(dataRoot, ctx.projectId);
  // A symlink/junction may not replace the project directory itself.
  const source = realpathSync(ctx.resolvePath(path));
  if (!below(root, source)) {
    throw new Error("Preview image is outside managed project storage");
  }
  return source;
}

/** Existing HyperFrames browser only: never install or download a browser for a preview. */
export function previewBrowserPath(): string {
  const candidates = [process.env.HYPERFRAMES_BROWSER_PATH, process.env.PRODUCER_HEADLESS_SHELL_PATH,
    ...(process.platform === "win32" ? [join(process.env.ProgramW6432 ?? "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
      join(process.env.LOCALAPPDATA ?? homedir(), "Google/Chrome/Application/chrome.exe")]
      : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]),
  ];
  for (const path of candidates) if (path && existsSync(path)) return path;
  const cache = process.env.HYPERFRAMES_CACHE_DIR ?? join(homedir(), ".cache", "hyperframes");
  const find = (dir: string, depth: number): string | undefined => {
    if (depth > 5 || !existsSync(dir)) return undefined;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isFile() && /^(?:chrome|chrome-headless-shell|headless_shell)(?:\.exe)?$/.test(entry.name)) return path;
      if (entry.isDirectory()) { const found = find(path, depth + 1); if (found) return found; }
    }
    return undefined;
  };
  const found = find(cache, 0);
  if (found) return found;
  throw new AppError(503, "PREVIEW_BROWSER_UNAVAILABLE", "Chưa có trình duyệt dựng đồ họa. Cấu hình HYPERFRAMES_BROWSER_PATH tới Chromium đã cài.");
}

let inlineAssets: { gsap: string; common: string } | undefined;
function assets() {
  if (inlineAssets) return inlineAssets;
  const fontRoot = join(dirname(require.resolve("@fontsource/be-vietnam-pro/package.json")), "files");
  const common = readFileSync(join(composeAssetRoot(), "common.js"), "utf8").replace(
    /font(?:-latin-ext|-latin)?(?:-bold)?\.woff2/g, (file) => {
      const subset = file.includes("latin-ext") ? "latin-ext" : file.includes("latin") ? "latin" : "vietnamese";
      return `data:font/woff2;base64,${readFileSync(join(fontRoot, `be-vietnam-pro-${subset}-${file.includes("bold") ? 700 : 400}-normal.woff2`)).toString("base64")}`;
    });
  return inlineAssets = { gsap: readFileSync(gsapFile(), "utf8"), common };
}

type PuppeteerModule = typeof import("puppeteer-core");
let puppeteerLoad: Promise<PuppeteerModule> | undefined;
/** Loads the HyperFrames puppeteer adapter once per process. A failed load is retried on the next call. */
export function loadPreviewPuppeteer(): Promise<PuppeteerModule> {
  return puppeteerLoad ??= (async () => {
    // Resolve through the already-installed HyperFrames engine, not a new npm dependency.
    let puppeteer: PuppeteerModule | undefined;
    const stopImport = previewStage("import-puppeteer");
    try {
      const engine = createRequire(require.resolve("hyperframes/package.json"));
      puppeteer = await import(pathToFileURL(engine.resolve("puppeteer-core")).href) as PuppeteerModule;
    } catch { /* Installed engine may change its browser adapter. */ }
    stopImport();
    if (!puppeteer?.launch) throw new PreviewAdapterUnavailable("HyperFrames browser adapter unavailable");
    return puppeteer;
  })().catch((error: unknown) => { puppeteerLoad = undefined; throw error; });
}

export type PreviewWarmState = "idle" | "running" | "ready" | "failed";
let warmState: PreviewWarmState = "idle";
export function previewWarmState(): PreviewWarmState { return warmState; }

/**
 * TASK-139b: pays the once-per-process cost (adapter import, inline assets) before the first preview.
 * Never throws; a failure is reported in the result and the state. It does not launch a browser.
 */
export async function warmPreviewRuntime(load: () => Promise<PuppeteerModule> = loadPreviewPuppeteer): Promise<{ ok: boolean; ms: number; reason?: string }> {
  const started = performance.now();
  warmState = "running";
  try {
    await load();
    previewBrowserPath();
    assets();
    warmState = "ready";
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (error) {
    warmState = "failed";
    return { ok: false, ms: Math.round(performance.now() - started), reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Same shared zoompan equations as RENDER, evaluated only over the requested range. */
export function stillPreviewFilter(shot: Shot, target: RenderTarget, offsetSec: number, frames: number, fps: number): string {
  const total = shotFrameCount(shot, target.fps);
  const source = shot.source.kind === "still" ? shot.source : null;
  const expr = zoompanExprs(presetMotion(source?.motion ?? "static"), total);
  const frame = Math.round(offsetSec * target.fps);
  const clock = frames === 1 ? String(frame) : `(${frame}+on*${target.fps}/${fps})`;
  const at = (value: string) => value.replace(/\bon\b/g, clock);
  const { width: w, height: h } = target;
  // RENDER uses a 2x cover crop before zoompan, focused at motion.from.
  const focus = presetMotion(source?.motion ?? "static")?.from ?? { x: 0.5, y: 0.5 };
  return `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w * 2}:${h * 2}:(iw-${w * 2})*${focus.x}:(ih-${h * 2})*${focus.y},setsar=1,`
    + `zoompan=z='${at(expr.z)}':x='${at(expr.x)}':y='${at(expr.y)}':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`;
}

/** One operation owns one lazy browser; scenes share it, and finally always closes it. */
export class PreviewShotRenderer {
  private browser: Promise<Browser> | undefined;
  private durations = new Map<string, Promise<number>>();
  constructor(private readonly target: RenderTarget, private readonly ctx: ComposeRenderContext, private readonly ffmpeg: PreviewFfmpeg) {}

  async close(): Promise<void> {
    if (!this.browser) return;
    const stopClose = previewStage("browser-close");
    await this.browser.then((browser) => browser.close(), () => undefined);
    stopClose();
  }

  private launch(): Promise<Browser> {
    return this.browser ??= (async () => {
      const puppeteer = await loadPreviewPuppeteer();
      const stopPath = previewStage("browser-path");
      const executablePath = previewBrowserPath();
      stopPath();
      const stopLaunch = previewStage("puppeteer-launch");
      const browser = await puppeteer.launch({ executablePath, headless: /(?:headless[-_]shell)(?:\.exe)?$/i.test(executablePath) ? "shell" : true,
        timeout: 5000, protocolTimeout: 10000,
        args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run",
          "--proxy-server=http://127.0.0.1:1", "--proxy-bypass-list=<-loopback>"] });
      stopLaunch();
      return browser;
    })();
  }

  private async graphicPage(shot: Shot): Promise<Page> {
    if (!/^[a-z0-9_]+$/.test(shot.source.kind)) throw new Error("Invalid preview template");
    const source = join(composeAssetRoot(), shot.source.kind, "index.html");
    if (!existsSync(source)) throw new AppError(422, "PREVIEW_SHOT_FAILED", "Không tìm thấy mẫu đồ họa xem trước.");
    const stopLaunchWait = previewStage("launch-wait");
    const browser = await this.launch();
    stopLaunchWait();
    const stopNewPage = previewStage("new-page");
    const page = await browser.newPage();
    stopNewPage();
    try {
      await page.setViewport({ width: this.target.width, height: this.target.height, deviceScaleFactor: 1 });
      page.setDefaultTimeout(5000);
      await page.setRequestInterception(true);
      let blocked = false;
      page.on("request", (request) => {
        if (request.url().startsWith("data:")) void request.continue().catch(() => undefined);
        else {
          blocked = true;
          void request.abort().catch(() => undefined);
        }
      });
      const duration = shotFrameCount(shot, this.target.fps) / this.target.fps;
      const variables = graphicVariables(shot, duration, this.target, { ...this.ctx, grain: this.ctx.graphicGrain,
        resolvePath: (path) => previewGraphicAsset(this.ctx, path) });
      const safeJson = JSON.stringify(variables).replace(/</g, "\\u003c");
      const stopAssets = previewStage("assets");
      const local = assets();
      stopAssets();
      const stopContent = previewStage("build-and-set-content");
      const html = writeCompositionHtml(readFileSync(source, "utf8"), { ...this.target, durationSec: duration })
        .replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">`)
        .replace('<script src="gsap.min.js"></script>', () => `<script>${local.gsap}</script>`)
        .replace('<script src="common.js"></script>', () => `<script>window.__hyperframes={getVariables:()=>(${safeJson})};${local.common}</script>`);
      await page.setContent(html, { waitUntil: "load", timeout: 5000 });
      stopContent();
      const stopFonts = previewStage("fonts-and-images");
      await page.evaluate(async () => {
        await Promise.race([Promise.all([document.fonts.ready, ...Array.from(document.images).map((image) => image.decode())]),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Preview assets timed out")), 5000))]);
      });
      stopFonts();
      if (blocked) throw new AppError(422, "PREVIEW_SHOT_FAILED", "Mẫu xem trước yêu cầu tài nguyên ngoài máy; đã từ chối kết nối.");
      return page;
    } catch (error) { await page.close(); throw error; }
  }

  private async capture(page: Page, atSec: number, path: string, measure = false) {
    const geometry = await page.evaluate(async (time, measureText) => {
      const timeline = (window as unknown as { __timelines: { main: { seek(time: number, suppressEvents: boolean): void } } }).__timelines.main;
      // Never return the GSAP timeline: it is thenable and a paused seek would hang.
      timeline.seek(time, false);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!measureText) return null;
      const stage = document.getElementById("stage");
      const root = document.getElementById("root");
      if (!stage || !root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const rects = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || !node.parentElement || node.parentElement.closest("script,style,title,desc")) continue;
        let visible = true;
        for (let el: Element | null = node.parentElement; el && el !== root; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) <= 0.01) { visible = false; break; }
        }
        if (!visible) continue;
        range.selectNodeContents(node);
        for (const { left, top, right, bottom, width, height } of range.getClientRects()) {
          if (width > 0 && height > 0) rects.push({ left, top, right, bottom });
        }
      }
      const { left, top, right, bottom } = stage.getBoundingClientRect();
      return { box: { left, top, right, bottom }, rects };
    }, atSec, measure);
    const stopShot = previewStage("screenshot");
    await page.screenshot({ path: path as `${string}.jpg`, type: "jpeg", quality: 85, captureBeyondViewport: false });
    stopShot();
    return geometry;
  }

  private async footageSeek(shot: Shot, atSec: number): Promise<{ path: string; seek: number }> {
    if (shot.source.kind !== "footage") throw new Error("Expected footage");
    const path = this.ctx.resolvePath(shot.source.path ?? "");
    const duration = this.durations.get(path) ?? probeDurationSec(path);
    this.durations.set(path, duration);
    const end = await duration;
    return { path, seek: Math.max(0, Math.min(shot.source.inSec + atSec, Math.max(0, end - 1 / this.target.fps))) };
  }

  async frames(shot: Shot, frames: Capture[], measure = true): Promise<(SafeAreaResult | null)[]> {
    if (shot.source.kind === "footage" || shot.source.kind === "still") {
      for (const frame of frames) {
        const source = shot.source.kind === "footage" ? await this.footageSeek(shot, frame.atSec) : null;
        const image = shot.source.kind === "still" && shot.source.path ? this.ctx.resolvePath(shot.source.path) : null;
        const args = source ? ["-ss", source.seek.toFixed(6), "-protocol_whitelist", "file,pipe", "-i", source.path, "-vf", this.cover()]
          : image ? ["-protocol_whitelist", "file,pipe", "-i", image, "-vf", stillPreviewFilter(shot, this.target, frame.atSec, 1, this.target.fps)]
            : ["-f", "lavfi", "-i", `color=c=${PLACEHOLDER_COLOR}:s=${this.target.width}x${this.target.height}`];
        await this.ffmpeg([...BASE, ...args, "-frames:v", "1", "-q:v", "3", frame.path]);
      }
      return frames.map(() => null);
    }
    const page = await this.graphicPage(shot);
    try {
      const duration = shotFrameCount(shot, this.target.fps) / this.target.fps;
      const staticMode = this.ctx.composeGraphics === "static";
      const base = join(dirname(frames[0]!.path), "graphic-base.jpg");
      const staticGeometry = staticMode ? await this.capture(page, finishedSeekSec(duration, this.target.fps).startSec, base, measure) : null;
      const safeAreas: (SafeAreaResult | null)[] = [];
      for (const frame of frames) {
        if (!staticMode) {
          const geometry = await this.capture(page, frame.atSec, frame.path, measure);
          safeAreas.push(geometry ? measuredSafeArea(geometry.box, geometry.rects) : null);
        }
        else {
          const n = Math.round(frame.atSec * this.target.fps), total = shotFrameCount(shot, this.target.fps);
          const zoom = 1 + 0.08 * n / total, fade = Math.min(1, frame.atSec / 0.2);
          await this.ffmpeg([...BASE, "-i", base, "-vf", `scale=trunc(iw*${zoom}/2)*2:trunc(ih*${zoom}/2)*2,crop=${this.target.width}:${this.target.height},colorchannelmixer=rr=${fade}:gg=${fade}:bb=${fade}`,
            "-frames:v", "1", "-q:v", "3", frame.path]);
          const centerX = this.target.width / 2, centerY = this.target.height / 2;
          const x = (value: number) => centerX + (value - centerX) * zoom;
          const y = (value: number) => centerY + (value - centerY) * zoom;
          safeAreas.push(staticGeometry ? measuredSafeArea(staticGeometry.box, fade === 0 ? [] : staticGeometry.rects.map((rect) => ({
            left: x(rect.left), right: x(rect.right), top: y(rect.top), bottom: y(rect.bottom),
          }))) : null);
        }
      }
      return safeAreas;
    } finally { await page.close(); }
  }

  private cover(): string { return `scale=${this.target.width}:${this.target.height}:force_original_aspect_ratio=increase,crop=${this.target.width}:${this.target.height},setsar=1`; }

  async segment(shot: Shot, offsetSec: number, durationSec: number, output: string, fps: number): Promise<void> {
    const count = Math.max(1, Math.round(durationSec * fps));
    if (shot.source.kind === "footage") {
      const source = await this.footageSeek(shot, offsetSec);
      await this.ffmpeg([...BASE, "-ss", source.seek.toFixed(6), "-protocol_whitelist", "file,pipe", "-i", source.path, "-vf", `${this.cover()},fps=${fps},tpad=stop_mode=clone:stop=${count}`,
        "-frames:v", String(count), "-r", String(fps), ...CLIP, output]);
      return;
    }
    if (this.ctx.composeGraphics === "static" && shot.source.kind !== "still") {
      const page = await this.graphicPage(shot);
      const base = join(dirname(output), "graphic-base.jpg");
      const total = shotFrameCount(shot, this.target.fps);
      try { await this.capture(page, finishedSeekSec(total / this.target.fps, this.target.fps).startSec, base); }
      finally { await page.close(); }
      const clock = `(${offsetSec}*${this.target.fps}+n*${this.target.fps}/${fps})`;
      const zoom = `scale=w='trunc(iw*(1+0.08*${clock}/${total})/2)*2':h='trunc(ih*(1+0.08*${clock}/${total})/2)*2':eval=frame`;
      const fade = offsetSec < 0.2 ? `,setpts=PTS+${offsetSec}/TB,fade=t=in:st=0:d=0.2,setpts=PTS-STARTPTS` : "";
      await this.ffmpeg([...BASE, "-loop", "1", "-framerate", String(fps), "-i", base,
        "-vf", `${zoom},crop=${this.target.width}:${this.target.height}${fade}`,
        "-frames:v", String(count), ...CLIP, output]);
      return;
    }
    if (shot.source.kind === "still") {
      const path = shot.source.path ? this.ctx.resolvePath(shot.source.path) : null;
      const inputs = path ? ["-protocol_whitelist", "file,pipe", "-i", path, "-vf", stillPreviewFilter(shot, this.target, offsetSec, count, fps)]
        : ["-f", "lavfi", "-i", `color=c=${PLACEHOLDER_COLOR}:s=${this.target.width}x${this.target.height}:r=${fps}`];
      await this.ffmpeg([...BASE, ...inputs, "-frames:v", String(count), "-r", String(fps), ...CLIP, output]);
      return;
    }
    const samples = Array.from({ length: count }, (_, n) => ({ atSec: offsetSec + n / fps, path: join(dirname(output), `frame-${String(n + 1).padStart(4, "0")}.jpg`) }));
    await this.frames(shot, samples, false);
    await this.ffmpeg([...BASE, "-framerate", String(fps), "-i", join(dirname(output), "frame-%04d.jpg"), "-frames:v", String(count), ...CLIP, output]);
  }
}
