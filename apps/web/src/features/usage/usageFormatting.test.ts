import { describe, expect, it } from "vitest";
import { formatTokens, formatUsd, formatVnd } from "./usageFormatting";

describe("usage formatting", () => {
  it("uses compact token values and preserves unknown token counts", () => {
    expect(formatTokens(12_345)).toBe("12.3K");
    expect(formatTokens(2_000_000)).toBe("2M");
    expect(formatTokens(0, true)).toBe("Không rõ");
    expect(formatTokens(57_479, true)).toBe("≥ 57.5K");
  });

  it("formats estimated USD and converts it to VND using the configured rate", () => {
    expect(formatUsd(0.0123)).toBe("$0.0123");
    expect(formatVnd(0.01, 26000)).toContain("260");
  });
});
