import { describe, expect, it } from "vitest";
import { OPERATOR_SKILLS } from "../src/operator/skills.js";

describe("OPERATOR_SKILLS names", () => {
  it("every skill name is unique", () => {
    const seen = new Map<string, number>();
    for (const skill of OPERATOR_SKILLS) seen.set(skill.name, (seen.get(skill.name) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    expect(duplicates).toEqual([]);
  });

  it("the research skill no longer uses the shared name research-provider", () => {
    const named = OPERATOR_SKILLS.filter((skill) => skill.name === "research-provider");
    expect(named.every((skill) => !skill.research)).toBe(true);
  });
});
