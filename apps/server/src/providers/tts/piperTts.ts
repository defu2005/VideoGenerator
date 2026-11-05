import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildPiperArgs, ttsCatalogEntry } from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";

const entry = ttsCatalogEntry("piper")!;

export function voicesFromOnnxDirectory(folder: string): TtsVoice[] {
  let names: string[] = [];
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".onnx"));
  } catch {
    return [];
  }
  return names.map((fileName) => {
    let language = "und";
    try {
      const meta = JSON.parse(readFileSync(join(folder, `${fileName}.json`), "utf8")) as {
        language?: string | { code?: string };
        espeak?: { voice?: string };
      };
      const code = typeof meta.language === "string" ? meta.language : meta.language?.code;
      language = code || meta.espeak?.voice || language;
    } catch {
      language = "und";
    }
    return { name: fileName.replace(/\.onnx$/, ""), language, gender: "unknown" as const };
  });
}

export class PiperTtsProvider implements TtsProvider {
  id = "piper";
  label = entry.label;
  capabilities = {
    wordTimings: entry.wordTimings,
    ssml: entry.ssml,
    maxCharsPerRequest: entry.maxCharsPerRequest,
    languages: entry.languages,
  };

  constructor(private readonly ctx: TtsContext) {}

  isAvailable(): boolean {
    const settings = this.ctx.settings();
    return Boolean(settings.piperBinary.trim() && settings.piperModelsDir.trim());
  }

  async listVoices(): Promise<TtsVoice[]> {
    const folder = this.ctx.settings().piperModelsDir.trim();
    return folder ? voicesFromOnnxDirectory(folder) : [];
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const settings = this.ctx.settings();
    const binary = settings.piperBinary.trim();
    const folder = settings.piperModelsDir.trim();
    if (!binary || !folder) throw new Error("Chưa cấu hình Piper (đường dẫn chương trình và thư mục model).");
    const model = input.voice.endsWith(".onnx") ? input.voice : join(folder, `${input.voice}.onnx`);
    mkdirSync(dirname(input.outPath), { recursive: true });
    await runPiper(this.ctx, binary, buildPiperArgs(model, input.outPath), input.text, input.signal);
    return {
      durationSec: await this.ctx.probeDuration(input.outPath, input.signal),
      cues: [],
      timingSource: "estimated",
      characters: input.text.length,
    };
  }
}

export function runPiper(
  ctx: TtsContext,
  binary: string,
  args: string[],
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = ctx.spawnProcess(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new Error(stderr || `piper exited with code ${code}`));
    });
    child.stdin?.write(text);
    child.stdin?.end();
  });
}

export function writePiperText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}
