import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearPlanInputs, readPlanInputs, writePlanInputs } from "../src/compose/planInputs.js";

describe("plan sidecar ordering (TASK-139 fix4)", () => {
  it("clearPlanInputs removes the sidecar so a crash before the new sidecar leaves no stale fingerprint", () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-plan-order-"));
    try {
      writePlanInputs(dir, "old-fingerprint");
      expect(readPlanInputs(dir)).toBe("old-fingerprint");
      // Writer order: clear, then write plan, then write sidecar. A crash after the plan write sees no sidecar.
      clearPlanInputs(dir);
      expect(existsSync(join(dir, "compose-plan.inputs.json"))).toBe(false);
      expect(readPlanInputs(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
