import { describe, expect, it } from "vitest";
import { AgentWaitMinutesSchema, resolveAgentWaitMinutes, resolveStageExecution, StageExecutionSettingsSchema } from "../src/agents/stageExecution.js";

describe("stage executor settings", () => {
  it("resolves each stage project → profile → default without filling overrides", () => {
    const profile = { stageExecution: { VISUAL_SEARCH: "agent", SCRIPT: "app_then_agent" } as const, agentWaitMinutes: 45 };
    expect(resolveStageExecution("VISUAL_SEARCH", {})).toBe("app_then_agent");
    expect(resolveStageExecution("SCRIPT", {})).toBe("app");
    expect(resolveStageExecution("VISUAL_SEARCH", {}, profile)).toBe("agent");
    expect(resolveStageExecution("VISUAL_SEARCH", { stageExecution: { VISUAL_SEARCH: "app" } }, profile)).toBe("app");
    expect(resolveStageExecution("SCRIPT", { stageExecution: { VISUAL_SEARCH: "app" } }, profile)).toBe("app_then_agent");
    expect(resolveAgentWaitMinutes({}, profile)).toBe(45);
    expect(resolveAgentWaitMinutes({ agentWaitMinutes: 12 }, profile)).toBe(12);
    expect(resolveAgentWaitMinutes({})).toBe(30);
    expect(StageExecutionSettingsSchema.parse({})).toEqual({});
  });
  it("rejects unknown modes/stages and unbounded wait times", () => {
    expect(StageExecutionSettingsSchema.safeParse({ UNKNOWN: "app" }).success).toBe(false);
    expect(StageExecutionSettingsSchema.safeParse({ SCRIPT: "AGENT" }).success).toBe(false);
    expect(StageExecutionSettingsSchema.safeParse({ SCRIPT: "agent" }).success).toBe(false);
    expect(StageExecutionSettingsSchema.safeParse({ SCRIPT: "app", VISUAL_SEARCH: "agent" }).success).toBe(true);
    for (const wait of [0, -1, 1.5, 1441, Infinity]) expect(AgentWaitMinutesSchema.safeParse(wait).success).toBe(false);
  });
});
