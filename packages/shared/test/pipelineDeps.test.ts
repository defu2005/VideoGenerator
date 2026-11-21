import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES, type PipelineStage } from "../src/enums.js";
import { GATES, STAGE_DEPENDS, STAGE_ORDER, dependentStages } from "../src/pipeline.js";

describe("stage dependency graph", () => {
  it("lists every stage and has no cycle", () => {
    expect(Object.keys(STAGE_DEPENDS).sort()).toEqual([...PIPELINE_STAGES].sort());
    const visiting = new Set<PipelineStage>();
    const visited = new Set<PipelineStage>();
    const cyclic = (stage: PipelineStage): boolean => {
      if (visiting.has(stage)) return true;
      if (visited.has(stage)) return false;
      visiting.add(stage);
      for (const dep of STAGE_DEPENDS[stage]) {
        if (cyclic(dep)) return true;
      }
      visiting.delete(stage);
      visited.add(stage);
      return false;
    };
    for (const stage of PIPELINE_STAGES) expect(cyclic(stage)).toBe(false);
  });

  it("puts every dependency earlier in the display order", () => {
    for (const stage of STAGE_ORDER) {
      for (const dep of STAGE_DEPENDS[stage]) {
        expect(STAGE_ORDER.indexOf(dep)).toBeGreaterThanOrEqual(0);
        expect(STAGE_ORDER.indexOf(dep)).toBeLessThan(STAGE_ORDER.indexOf(stage));
      }
    }
  });

  it("stales the visual lane and timeline without touching voice or music", () => {
    const dependents = dependentStages("VISUAL_SEARCH");
    expect(dependents).toContain("VISUAL_REVIEW");
    expect(dependents).toContain("TIMELINE");
    expect(dependents).toContain("FINAL_APPROVAL");
    expect(dependents).toContain("RENDER");
    expect(dependents).not.toContain("VOICE");
    expect(dependents).not.toContain("SUBTITLE");
    expect(dependents).not.toContain("MUSIC_SEARCH");
    expect(dependents).not.toContain("MUSIC_REVIEW");
  });

  it("still marks the whole tail stale when the script changes", () => {
    const dependents = dependentStages("SCRIPT");
    for (const stage of STAGE_ORDER.slice(STAGE_ORDER.indexOf("SCRIPT") + 1)) {
      expect(dependents).toContain(stage);
    }
  });
});

describe("TASK-146 slice 6 commit A: SCRIPT_REVIEW gate", () => {
  it("sits between SCRIPT and SCENE_PLAN, is a gate, and gates SCENE_PLAN", () => {
    const order = STAGE_ORDER as readonly string[];
    expect(order.indexOf("SCRIPT_REVIEW")).toBe(order.indexOf("SCRIPT") + 1);
    expect(order.indexOf("SCENE_PLAN")).toBe(order.indexOf("SCRIPT_REVIEW") + 1);
    expect(GATES).toContain("SCRIPT_REVIEW");
    expect(STAGE_DEPENDS.SCRIPT_REVIEW).toEqual(["SCRIPT"]);
    expect(STAGE_DEPENDS.SCENE_PLAN).toEqual(["SCRIPT_REVIEW"]);
  });

  it("rerunning SCRIPT reaches the gate and everything after it", () => {
    const dependents = dependentStages("SCRIPT");
    expect(dependents).toContain("SCRIPT_REVIEW");
    expect(dependents).toContain("SCENE_PLAN");
  });
});
