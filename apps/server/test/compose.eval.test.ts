import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appendGraphicsModeEval, renderStyleSamples, renderTemplateSamples, writeEvalDoc } from "../src/compose/eval/runEval.js";

const enabled = process.env.VG_COMPOSE_EVAL === "1";

describe.skipIf(!enabled)("compose eval", () => {
  it("writes the legacy, baseline, rule and rule+llm(mock) rows", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const doc = join(root, "docs", "compose", "EVAL.md");
    const result = await writeEvalDoc(doc);
    expect(result.hyperframes === null || typeof result.hyperframes === "string").toBe(true);
  }, 1_800_000);
});

describe.skipIf(!enabled)("graphics mode eval", () => {
  it("measures ECO, BALANCED and QUALITY at 1080x1920", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const result = await appendGraphicsModeEval(join(root, "docs", "compose", "EVAL.md"));
    expect(result.rows).toHaveLength(9);
  }, 3_600_000);
});

// VG_COMPOSE_SAMPLES=1 renders the graphic styles with real HyperFrames; VG_COMPOSE_SAMPLE_ONLY narrows it.
describe.skipIf(process.env.VG_COMPOSE_SAMPLES !== "1")("compose template samples", () => {
  it("writes one frame per style and aspect", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const result = await renderTemplateSamples(join(root, "docs", "compose", "samples"), process.env.VG_COMPOSE_SAMPLE_ONLY);
    writeFileSync(join(root, "docs", "compose", "samples", "timings.json"), JSON.stringify(result.seconds, null, 2));
    expect(result.warnings).toEqual([]);
    expect(result.files.length).toBeGreaterThan(0);
  }, 900_000);
});

describe.skipIf(process.env.VG_COMPOSE_SAMPLES !== "1")("style preset samples", () => {
  it("writes two presets at 16:9 and 9:16", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const known = ["list_full", "compare", "quote_full", "kinetic_text", "chart", "map"];
    const requested = process.env.VG_COMPOSE_SAMPLE_ONLY;
    const templateId = requested && known.includes(requested) ? requested : "list_full";
    const out = templateId === "list_full"
      ? join(root, "docs", "compose", "samples", "style")
      : join(root, "docs", "compose", "samples", "style", templateId);
    const result = await renderStyleSamples(out, templateId);
    expect(result.warnings).toEqual([]);
    const expected = process.env.VG_STYLE_SAMPLE_ONLY ? 1 : 4;
    expect(result.files).toHaveLength(expected);
  }, 900_000);
});
