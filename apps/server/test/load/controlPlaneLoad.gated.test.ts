import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runLoadBenchmark } from "./controlPlaneLoad.js";

// Gated: runs only with RUN_LOAD_TEST=1 (no network, no real LLM/TTS). See TASK-143.
describe.skipIf(process.env.RUN_LOAD_TEST !== "1")("TASK-143 control-plane load (measured)", () => {
  it("runs the benchmark for 5, 20, 50 nodes and prints the table", () => {
    const counts = (process.env.LOAD_NODES ?? "5,20,50").split(",").map(Number);
    const results = runLoadBenchmark(counts);
    const out = process.env.LOAD_OUT;
    if (out) writeFileSync(out, JSON.stringify(results, null, 2));
    expect(results.length).toBe(counts.length);
    for (const r of results) expect(r.totalStatements).toBeGreaterThan(0);
  }, 300_000);
});
