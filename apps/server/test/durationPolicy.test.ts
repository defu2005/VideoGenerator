import { describe, expect, it } from "vitest";
import type { Script } from "@vg/shared";
import { checkScriptDuration } from "../src/stages/script/scriptUtils.js";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const script = (n: number): Script => ({
  title: "t", hook: "", outro: "",
  sections: [{ id: "s", heading: "h", narration: words(n), visualQueries: { primary: "", alternatives: [] }, visualNotes: "", musicMood: "", energy: "medium", estDurationSec: 0 }],
  music: { mood: "", energy: "medium", keywords: [] },
});

describe("script duration policy (near misses do not cost a repair call)", () => {
  it("accepts within ±20% without warning", () => {
    expect(checkScriptDuration(script(150), 60, 150)).toMatchObject({ duration: 60, reject: null, warning: null });
  });
  it("accepts a near miss (75s for 60s) with a warning", () => {
    const result = checkScriptDuration(script(188), 60, 150);
    expect(result.reject).toBeNull();
    expect(result.warning).toContain("~75s");
  });
  it("rejects clearly broken output (< 50% or > 200%)", () => {
    expect(checkScriptDuration(script(50), 60, 150).reject).toMatch(/between 30 and 120/);
    expect(checkScriptDuration(script(400), 60, 150).reject).not.toBeNull();
  });
});
