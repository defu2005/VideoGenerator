import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildVieNeuArgv, ttsCatalogEntry } from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";

const entry = ttsCatalogEntry("vieneu")!;

export class VieNeuTtsProvider implements TtsProvider {
  id = "vieneu";
  label = entry.label;
  capabilities = {
    wordTimings: entry.wordTimings,
    ssml: entry.ssml,
    maxCharsPerRequest: entry.maxCharsPerRequest,
    languages: entry.languages,
  };

  constructor(private readonly ctx: TtsContext) {}

  isAvailable(): boolean {
    return this.ctx.settings().vieneuTemplate.includes("{out}");
  }

  async listVoices(): Promise<TtsVoice[]> {
    return [{ language: "vi", gender: "unknown", name: "default" }];
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const template = this.ctx.settings().vieneuTemplate.trim();
    const inPath = join(dirname(input.outPath), `${randomUUID()}.txt`);
    const argv = buildVieNeuArgv(template, { inPath, outPath: input.outPath, voice: input.voice });
    const [command, ...args] = argv;
    if (!command) throw new Error("Lệnh VieNeu trống.");
    mkdirSync(dirname(input.outPath), { recursive: true });
    writeFileSync(inPath, input.text, "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = this.ctx.spawnProcess(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const onAbort = () => child.kill();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        input.signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.on("close", (code) => {
        input.signal?.removeEventListener("abort", onAbort);
        if (code === 0) resolve();
        else reject(new Error(stderr || `VieNeu exited with code ${code}`));
      });
    });
    return {
      durationSec: await this.ctx.probeDuration(input.outPath, input.signal),
      cues: [],
      timingSource: "estimated",
      characters: input.text.length,
    };
  }
}
