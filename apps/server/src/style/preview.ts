import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stylePackFingerprint, type AspectRatio, type Shot, type StylePack } from "@vg/shared";
import { graphicVariables } from "../compose/render/graphicVars.js";
import { renderComposeTemplate } from "../compose/hyperframes.js";
import { resolveFfmpegPath } from "../media/ffmpeg.js";
import { summarizeStyle, type StyleSummary } from "./designer.js";

export type PreviewFrame = { id: "title" | "kinetic" | "list"; label: string; dataUrl: string };

export type StylePreview = {
  fingerprint: string;
  aspect: AspectRatio;
  frames: PreviewFrame[];
  /** The token swatch is always there, even when no frame could be rendered. */
  style: StyleSummary;
  warning?: string;
  cached: boolean;
};

const SIZES: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 1000, height: 1000 },
};

type FrameSpec = { id: PreviewFrame["id"]; label: string; durationSec: number; source: Shot["source"] };

const FRAMES: FrameSpec[] = [
  { id: "title", label: "Thẻ tiêu đề", durationSec: 3, source: { kind: "kinetic_text", lines: ["Tiêu đề của kênh", "một dòng phụ"], emphasis: [1], style: "bold" } as Shot["source"] },
  { id: "kinetic", label: "Chữ chuyển động", durationSec: 4, source: { kind: "kinetic_text", lines: ["Tiết kiệm điện mỗi tháng", "không bật máy lạnh"], emphasis: [1], style: "bold" } as Shot["source"] },
  {
    id: "list",
    label: "Danh sách",
    durationSec: 5,
    source: { kind: "list_full", title: "Thói quen buổi sáng", items: ["Uống một cốc nước ấm", "Vận động mười phút", "Không xem điện thoại", "Ăn sáng đủ chất"] } as Shot["source"],
  },
];

export type FrameRenderer = (input: {
  pack: StylePack;
  spec: FrameSpec;
  width: number;
  height: number;
  scratch: string;
}) => Promise<Buffer>;

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(resolveFfmpegPath(), ["-hide_banner", "-nostdin", "-loglevel", "error", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(stderr.trim().split(/\r?\n/).slice(-5).join("\n") || `ffmpeg thoát ${code}`))));
  });
}

/** Same still path as `renderStyleSamples` (TASK-108): HyperFrames template, then one PNG of the finished frame. */
export const renderFrameWithHyperframes: FrameRenderer = async ({ pack, spec, width, height, scratch }) => {
  const shot = { id: `style-preview-${spec.id}`, kind: spec.source.kind, startSec: 0, endSec: spec.durationSec, reason: "preview", source: spec.source } as Shot;
  const variables = graphicVariables(shot, spec.durationSec, { width, height }, {
    projectId: "style-preview",
    profileId: "style-preview",
    recipeId: "listicle",
    stylePack: pack,
  });
  const rendered = await renderComposeTemplate({
    dataDir: scratch,
    templateId: spec.source.kind,
    variables,
    width,
    height,
    fps: 30,
    durationSec: spec.durationSec,
  });
  if (!rendered.outputPath) throw new Error(rendered.warning ?? "HyperFrames không dựng được");
  const png = join(scratch, `${spec.id}.png`);
  await ffmpeg(["-y", "-ss", (spec.durationSec - 0.15).toFixed(2), "-i", rendered.outputPath, "-frames:v", "1", png]);
  return readFileSync(png);
};

export class StylePreviewer {
  constructor(
    private readonly dataDir: string,
    private readonly render: FrameRenderer = renderFrameWithHyperframes,
  ) {}

  private cacheDir(): string {
    return join(this.dataDir, "cache", "style-previews");
  }

  /** Cached by pack fingerprint + aspect. A render failure gives the swatch only, with a warning. */
  async preview(pack: StylePack, aspect: AspectRatio): Promise<StylePreview> {
    const fingerprint = stylePackFingerprint(pack);
    const style = summarizeStyle(pack);
    const key = `${fingerprint.replace(/[^a-z0-9]/gi, "")}-${aspect.replace(":", "x")}`;
    const dir = join(this.cacheDir(), key);
    const frames: PreviewFrame[] = [];
    const missing: string[] = [];
    let cachedCount = 0;
    for (const spec of FRAMES) {
      const file = join(dir, `${spec.id}.png`);
      if (existsSync(file)) {
        frames.push({ id: spec.id, label: spec.label, dataUrl: toDataUrl(readFileSync(file)) });
        cachedCount += 1;
      } else {
        missing.push(spec.id);
      }
    }
    if (missing.length === 0) return { fingerprint, aspect, frames, style, cached: true };

    const size = SIZES[aspect];
    let scratch: string | null = null;
    const failures: string[] = [];
    try {
      scratch = await mkdtemp(join(tmpdir(), "vg-style-preview-"));
      await mkdir(dir, { recursive: true });
      for (const spec of FRAMES) {
        if (!missing.includes(spec.id)) continue;
        try {
          const png = await this.render({ pack, spec, width: size.width, height: size.height, scratch });
          await writeFile(join(dir, `${spec.id}.png`), png);
          frames.push({ id: spec.id, label: spec.label, dataUrl: toDataUrl(png) });
        } catch (error) {
          failures.push(`${spec.label}: ${error instanceof Error ? error.message.split(/\r?\n/)[0] : "lỗi"}`);
        }
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "lỗi");
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
    const order = FRAMES.map((spec) => spec.id);
    frames.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return {
      fingerprint,
      aspect,
      frames,
      style,
      cached: cachedCount > 0 && failures.length === 0 && missing.length === 0,
      ...(failures.length > 0
        ? { warning: `Chưa dựng được ảnh xem thử (${failures.join("; ")}). Chỉ hiện bảng màu và phông chữ.` }
        : {}),
    };
  }
}

function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}
