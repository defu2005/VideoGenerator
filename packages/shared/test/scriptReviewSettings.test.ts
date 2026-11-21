import { describe, expect, it } from "vitest";
import { gateAutomatic, ProjectSettingsSchema } from "../src/schemas/project.js";

// TASK-146 slice 6 commit A red tests: the per-project SCRIPT_REVIEW setting. Default off, and it must survive a parse.
describe("TASK-146 slice 6 commit A: scriptOutlineApproval setting", () => {
  it("defaults to off, so existing projects keep today's flow", () => {
    expect(ProjectSettingsSchema.parse({}).scriptOutlineApproval).toBe("off");
  });

  it("keeps an explicit outline or script value instead of stripping it", () => {
    expect(ProjectSettingsSchema.parse({ scriptOutlineApproval: "outline" }).scriptOutlineApproval).toBe("outline");
    expect(ProjectSettingsSchema.parse({ scriptOutlineApproval: "script" }).scriptOutlineApproval).toBe("script");
  });

  it("rejects an unknown value", () => {
    expect(() => ProjectSettingsSchema.parse({ scriptOutlineApproval: "always" })).toThrow();
  });
});

// TASK-146 slice 6 commit B: SCRIPT_REVIEW is automatic only when off, in every mode; other gates keep the AUTO rule.
describe("TASK-146 slice 6 commit B: gateAutomatic", () => {
  it.each([
    ["AUTO", undefined, true],
    ["MANUAL", undefined, true],
    ["ASSISTED", "off", true],
    ["AUTO", "off", true],
    ["AUTO", "outline", false],
    ["AUTO", "script", false],
    ["MANUAL", "script", false],
    ["ASSISTED", "outline", false],
  ] as const)("SCRIPT_REVIEW in %s with approval %s is automatic: %s", (mode, approval, expected) => {
    expect(gateAutomatic("SCRIPT_REVIEW", mode, { scriptOutlineApproval: approval })).toBe(expected);
  });

  it("other gates follow AUTO mode, and FINAL_APPROVAL also needs autoRender", () => {
    expect(gateAutomatic("VISUAL_REVIEW", "AUTO", { scriptOutlineApproval: "script" })).toBe(true);
    expect(gateAutomatic("VISUAL_REVIEW", "MANUAL", {})).toBe(false);
    expect(gateAutomatic("FINAL_APPROVAL", "AUTO", {})).toBe(false);
    expect(gateAutomatic("FINAL_APPROVAL", "AUTO", { autoRender: true })).toBe(true);
    expect(gateAutomatic("FINAL_APPROVAL", "MANUAL", { autoRender: true })).toBe(false);
  });
});
