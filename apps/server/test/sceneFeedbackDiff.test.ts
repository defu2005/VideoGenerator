import { describe, expect, it } from "vitest";
import { diffScenes, type SceneSnapshot } from "../src/api/scenes.js";

const scene = (id: string, order: number, label = `s${order}`): SceneSnapshot => ({
  id, order, label, narration: `n-${id}`, visualQueries: "{}", noVisual: false,
});

describe("scene feedback diff (TASK-148a)", () => {
  it("returns no change when the plan is identical, so no row is written", () => {
    const plan = [scene("a", 0), scene("b", 1)];
    const diff = diffScenes(plan, plan.map((s) => ({ ...s })));
    expect(diff.before).toEqual([]);
    expect(diff.after).toEqual([]);
  });

  it("keeps only the edited scene and uses the scene:<order> target", () => {
    const before = [scene("a", 0), scene("b", 1), scene("c", 2)];
    const after = [scene("a", 0), { ...scene("b", 1), label: "renamed" }, scene("c", 2)];
    const diff = diffScenes(before, after);
    expect(diff.before.map((s) => s.id)).toEqual(["b"]);
    expect(diff.after.map((s) => s.label)).toEqual(["renamed"]);
    expect(diff.target).toBe("scene:1");
  });

  it("uses the scenes target when several scenes change", () => {
    const before = [scene("a", 0), scene("b", 1)];
    const after = [scene("b", 0), scene("a", 1)];
    const diff = diffScenes(before, after);
    expect(diff.before.length).toBe(2);
    expect(diff.target).toBe("scenes");
  });

  it("drops a deleted scene from the after side", () => {
    const before = [scene("a", 0), scene("b", 1)];
    const after = [scene("a", 0)];
    const diff = diffScenes(before, after);
    expect(diff.before.map((s) => s.id)).toEqual(["b"]);
    expect(diff.after).toEqual([]);
  });
});
