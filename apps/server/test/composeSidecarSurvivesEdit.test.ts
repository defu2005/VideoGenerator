import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComposePlanSchema, type ComposePlan } from "@vg/shared";
import { PLAN_INPUTS_FILE, readPlanInputs, writePlanInputs } from "../src/compose/planInputs.js";
import { editSavedComposeShot } from "../src/services/composeBridge.js";

// TASK-150 A: TESTS ONLY. editSavedComposeShot must not touch the plan sidecar; preview (planSource.ts:127) relies on it.
const SCENE_A = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = "fp-task-150-a";

function plan(): ComposePlan {
  return ComposePlanSchema.parse({
    version: 1, engine: "compose", preset: "story", aspect: "16:9",
    scenes: [{
      sceneId: SCENE_A, durationSec: 1.5, durationFrames: 45, fps: 30, warnings: [],
      shots: [{
        id: "a", kind: "still", startSec: 0, endSec: 1.5, reason: "baseline",
        source: { kind: "still", candidateId: "c1", path: "visuals/a.png", motion: "static" },
      }],
    }],
    stats: {
      shotsPerMin: 40, meanShotSec: 1.5, stdevShotSec: 0, kindEntropyBits: 1, maxSameKindRun: 1,
      wordGapCutPct: 1, beatCutPct: null,
      kindShare: { still: 1, footage: 0, kinetic_text: 0, chart: 0 },
    },
  });
}

describe("compose plan sidecar survives a manual shot edit (TASK-150 A)", () => {
  let renderDir: string;
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vg-sidecar-edit-"));
    renderDir = join(root, "render");
    mkdirSync(renderDir, { recursive: true });
    writeFileSync(join(renderDir, "compose-plan.json"), JSON.stringify(plan()));
    writePlanInputs(renderDir, FINGERPRINT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("editSavedComposeShot keeps the sidecar and its fingerprint", () => {
    const result = editSavedComposeShot(renderDir, "a", { locked: true });
    expect("plan" in result).toBe(true);
    expect(existsSync(join(renderDir, PLAN_INPUTS_FILE))).toBe(true);
    expect(readPlanInputs(renderDir)).toBe(FINGERPRINT);
  });

  it("the reader treats a missing sidecar as no valid saved plan (planSource.ts:127 then re-plans)", () => {
    unlinkSync(join(renderDir, PLAN_INPUTS_FILE));
    expect(readPlanInputs(renderDir)).toBeNull();
    // planSource reuses the saved plan only when readPlanInputs(renderDir) === fingerprint; null never matches.
    expect(readPlanInputs(renderDir) === FINGERPRINT).toBe(false);
  });
});
