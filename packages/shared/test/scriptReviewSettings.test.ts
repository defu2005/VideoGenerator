import { describe, expect, it } from "vitest";
import { ProjectSettingsSchema } from "../src/schemas/project.js";

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
