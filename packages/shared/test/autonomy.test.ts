import { describe, expect, it } from "vitest";
import { AUTONOMY_PRESETS, AutonomyLevelSchema, AutonomySettingsSchema, intersectAutonomy } from "../src/index.js";

describe("autonomy settings", () => {
  it("validates the presets and leaves computer use out of full autonomy", () => {
    for (const level of AutonomyLevelSchema.options) {
      expect(AutonomySettingsSchema.safeParse({ level, grants: AUTONOMY_PRESETS[level] }).success).toBe(true);
    }
    expect(AUTONOMY_PRESETS.autonomous.computerUse).toBe(false);
    expect(AutonomySettingsSchema.safeParse({ level: "autonomous", grants: { ...AUTONOMY_PRESETS.autonomous, publish: "anyone" } }).success).toBe(false);
  });

  it("uses the lower level and intersects gate, visibility and computer grants", () => {
    const full = { level: "autonomous", grants: { ...AUTONOMY_PRESETS.autonomous, computerUse: true } } as const;
    const limited = { level: "supervised", grants: AUTONOMY_PRESETS.supervised } as const;
    expect(intersectAutonomy(full, limited)).toEqual(limited);
  });
});
