import { describe, expect, it } from "vitest";
import { evaluateSkill, SKILL_EVAL_MIN_SCORE } from "../src/operator/skillEval.js";

// A skill without triggers has no "pick" scenarios, so its score used to come only from the three
// off-topic "skip" prompts and could reach 100 while the skill is never routed. It must fail the gate with a reason.
const NO_TRIGGER_MD = `---
name: probe-no-trigger
description: Skill thử nghiệm không có trigger
operator: true
area: tu-van-hanh
tools:
  - list_projects
risk: read
---

# Thử nghiệm

Nội dung thử nghiệm.
`;

describe("evaluateSkill without triggers", () => {
  it("does not reach the routing gate and says why", () => {
    const result = evaluateSkill(NO_TRIGGER_MD);
    expect(result.score).toBeLessThan(SKILL_EVAL_MIN_SCORE);
    expect(result.reason).toMatch(/trigger/);
  });
});
