import { describe, expect, it } from "vitest";
import { findRule } from "../src/auth/routePermissions.js";
import { toolAction } from "../src/auth/toolActions.js";

// TASK-129c slice 1: user mission routes need operator.use; agent mission routes need mailbox.use.
describe("route rules for missions", () => {
  it("user routes map to operator.use", () => {
    expect(findRule("GET", "/api/missions")?.action).toBe("operator.use");
    expect(findRule("POST", "/api/missions")?.action).toBe("operator.use");
    expect(findRule("POST", "/api/missions/abc/cancel")?.action).toBe("operator.use");
  });
  it("agent routes map to mailbox.use", () => {
    expect(findRule("PUT", "/api/mission-agents/abc/plan")?.action).toBe("mailbox.use");
    expect(findRule("POST", "/api/mission-agents/abc/move")?.action).toBe("mailbox.use");
  });
});

describe("tool actions for missions", () => {
  it("mission tools need mailbox.use", () => {
    for (const name of ["mission_get", "mission_set_plan", "mission_attach_project", "mission_move"]) {
      expect(toolAction(name)).toBe("mailbox.use");
    }
  });
});
