import { describe, expect, it } from "vitest";
import { BEHAVIOUR_SCENARIO_MAX, OFF_TOPIC_SCENARIOS, behaviourScenarios } from "../src/operator/skillEval.js";

// TASK-074b-2 review point 1: the off-topic prompts must survive the behaviour cap of 8 scenarios.
function md(triggers: string[], antiTriggers: string[]): string {
  return `---
name: probe-scenarios
description: Skill thử nghiệm kịch bản
operator: true
area: tu-van-hanh
triggers:
${triggers.map((item) => `  - ${item}`).join("\n")}
antiTriggers:
${antiTriggers.map((item) => `  - ${item}`).join("\n")}
tools:
  - list_projects
risk: read
---

# Thử nghiệm

Nội dung thử nghiệm.
`;
}

const OFF_TOPIC_IDS = OFF_TOPIC_SCENARIOS.map((item) => item.id);

describe("behaviour scenarios keep the off-topic prompts", () => {
  it("6 triggers and 4 anti-triggers: all three off-topic ids stay, at least one anti-trigger stays, total is at most 8", () => {
    const triggers = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const antis = ["a1", "a2", "a3", "a4"];
    const scenarios = behaviourScenarios(md(triggers, antis));
    const ids = scenarios.map((item) => item.id);
    for (const id of OFF_TOPIC_IDS) expect(ids).toContain(id);
    expect(ids.some((id) => id.startsWith("anti-"))).toBe(true);
    expect(scenarios.length).toBeLessThanOrEqual(BEHAVIOUR_SCENARIO_MAX);
    expect(scenarios.length).toBe(BEHAVIOUR_SCENARIO_MAX);
  });

  it("the anti-trigger slots are kept first: at most 2 picks are dropped before skips are cut", () => {
    const triggers = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const antis = ["a1", "a2", "a3", "a4"];
    const ids = behaviourScenarios(md(triggers, antis)).map((item) => item.id);
    expect(ids.filter((id) => id.startsWith("trigger-"))).toHaveLength(3);
    expect(ids.filter((id) => id.startsWith("anti-"))).toHaveLength(2);
  });

  it("a small skill keeps every scenario it has, off-topic included", () => {
    const scenarios = behaviourScenarios(md(["t1"], []));
    expect(scenarios.map((item) => item.id)).toEqual(["trigger-0", ...OFF_TOPIC_IDS]);
  });

  it("the off-topic prompts keep the skip expectation", () => {
    const scenarios = behaviourScenarios(md(["t1", "t2"], ["a1"]));
    for (const item of scenarios.filter((entry) => OFF_TOPIC_IDS.includes(entry.id))) {
      expect(item.expect).toBe("skip");
    }
  });
});
