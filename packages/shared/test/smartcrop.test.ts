import { describe, expect, it } from "vitest";
import { smartcropFocus } from "../src/index.js";

describe("smartcrop focus", () => {
  it("puts the focus on a bright block on the right", () => {
    const width = 40;
    const height = 20;
    const data = new Uint8Array(width * height * 4);
    for (let y = 4; y < 16; y += 1) {
      for (let x = 28; x < 38; x += 1) {
        const index = (y * width + x) * 4;
        data[index] = 255;
        data[index + 1] = 220;
        data[index + 2] = 40;
        data[index + 3] = 255;
      }
    }
    const first = smartcropFocus({ width, height, data }, 16 / 9);
    const second = smartcropFocus({ width, height, data }, 16 / 9);
    expect(first).toEqual(second);
    expect(first.x).toBeGreaterThan(0.5);
  });
});
