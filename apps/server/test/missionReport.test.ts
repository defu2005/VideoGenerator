import { describe, expect, it } from "vitest";
import { compareWithMedian, formatCheckpointReport } from "../src/missions/report.js";

// TASK-129c slice 2: checkpoint report text (Vietnamese, median comparison, optional metrics).
describe("checkpoint report", () => {
  it("compares views with the channel median in both directions", () => {
    expect(compareWithMedian(150, 100)).toBe("cao hơn trung vị kênh 50%");
    expect(compareWithMedian(80, 100)).toBe("thấp hơn trung vị kênh 20%");
    expect(compareWithMedian(80, null)).toBeNull();
    expect(compareWithMedian(80, 0)).toBeNull();
  });

  it("writes the 24 h report with optional metrics and omits what is missing", () => {
    const text = formatCheckpointReport("24h", { views: 1200, retentionPct: 42 }, 1000);
    expect(text).toContain("Báo cáo +24 giờ sau khi đăng: 1.200 lượt xem.");
    expect(text).toContain("So với kênh: cao hơn trung vị kênh 20%.");
    expect(text).toContain("Giữ chân khán giả: 42%.");
    expect(text).not.toContain("Tỉ lệ nhấp");
    expect(text).not.toContain("Doanh thu");
  });

  it("drops the median line when there is no baseline", () => {
    const text = formatCheckpointReport("2h", { views: 5, ctrPct: 3.5, revenueUsd: 0 }, null);
    expect(text).not.toContain("So với kênh");
    expect(text).toContain("Tỉ lệ nhấp: 3.5%.");
    expect(text).toContain("Doanh thu ghi nhận: 0 USD.");
  });
});
