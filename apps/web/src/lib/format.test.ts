import { describe, expect, it } from "vitest";
import { formatDateTime, formatMoney, formatRelative, visibleSlice } from "./format";

describe("format helpers", () => {
  it("writes local dates as dd/MM/yyyy HH:mm", () => {
    const date = new Date(2026, 10, 5, 15, 4);
    expect(formatDateTime(date)).toBe("05/11/2026 15:04");
  });

  it("describes a recent instant in minutes", () => {
    const now = Date.parse("2026-11-05T10:00:00.000Z");
    const then = new Date(now - 3 * 60 * 1000).toISOString();
    expect(formatRelative(then, now)).toBe("3 phút trước");
  });

  it("formats USD with 2 decimals and groups VND", () => {
    expect(formatMoney(12.5, "USD")).toMatch(/12[,.]50/);
    expect(formatMoney(1_000_000, "VND")).toMatch(/1\.000\.000|1,000,000/);
  });

  it("pages a long list without dropping the rest", () => {
    const items = ["a", "b", "c"];
    expect(visibleSlice(items, 2)).toEqual({ visible: ["a", "b"], hasMore: true });
    expect(visibleSlice(items, 5).hasMore).toBe(false);
  });
});
