import { describe, expect, it } from "vitest";
import { renderSnapshot } from "../src/operator/handbook.js";
import { historicalSuccess, routeQuery, ROUTING_WEIGHTS, type RouteCandidate, type RouteHit } from "../src/operator/routing.js";
import { diversify } from "../src/operator/routing.js";
import { runSuccessiveElimination } from "../src/operator/evalBudget.js";
import { OPERATOR_SKILLS, renderSkillMarkdown, validateSkillMarkdown } from "../src/operator/skills.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { renderHandbook } from "../src/operator/handbook.js";

function candidate(partial: Partial<RouteCandidate> & Pick<RouteCandidate, "id" | "name">): RouteCandidate {
  return {
    description: partial.description ?? partial.name,
    body: partial.body ?? partial.name,
    triggers: partial.triggers ?? [],
    antiTriggers: partial.antiTriggers ?? [],
    area: partial.area ?? "Quy trình",
    history: partial.history,
    shortBody: partial.shortBody,
    ...partial,
  };
}

describe("operator routing", () => {
  it("ranks an exact skill name first and folds Vietnamese diacritics", () => {
    const hits = routeQuery("dang video", [
      candidate({ id: "other", name: "other", description: "một việc khác", body: "không liên quan" }),
      candidate({ id: "publish-project", name: "publish-project", description: "Đăng video", body: "đăng video lên kênh", triggers: ["đăng"] }),
    ]);
    expect(hits[0]?.hits[0]?.id).toBe("publish-project");
  });

  it("scores triggers and subtracts anti-triggers", () => {
    const [part] = routeQuery("đăng xoá", [
      candidate({
        id: "publish-project",
        name: "publish-project",
        description: "Đăng",
        triggers: ["đăng"],
        antiTriggers: ["xoá"],
        area: "Đăng bài",
      }),
    ]);
    expect(part?.hits[0]?.breakdown.trigger).toBe(1);
    expect(part?.hits[0]?.breakdown.anti).toBe(0.3);
  });

  it("keeps routing weights at 1", () => {
    const sum = ROUTING_WEIGHTS.bm25 + ROUTING_WEIGHTS.trigger + ROUTING_WEIGHTS.history + ROUTING_WEIGHTS.area;
    expect(sum).toBeCloseTo(1);
  });

  it("drops a near-duplicate from the top results", () => {
    const base: RouteHit = {
      id: "a",
      name: "publish-project",
      description: "Đăng một dự án đã render lên tài khoản",
      area: "Đăng bài",
      score: 0.9,
      shortBody: "Đọc dự án rồi gọi đăng",
      breakdown: { bm25: 1, trigger: 1, history: 0.5, area: 1, anti: 0, total: 0.9 },
    };
    const copy: RouteHit = { ...base, id: "b", name: "publish-project-copy", score: 0.89 };
    const other: RouteHit = {
      ...base,
      id: "c",
      name: "quota-question",
      description: "Hỏi hạn mức model còn lại",
      shortBody: "Đọc quota rồi trả lời",
      score: 0.4,
    };
    const picked = diversify([base, copy, other], 3);
    expect(picked.map((hit) => hit.id)).toEqual(["a", "c"]);
  });

  it("splits a compound request into two routes", () => {
    const parts = routeQuery("đăng video rồi kiểm tra quota", [
      candidate({ id: "publish-project", name: "publish-project", description: "đăng video", triggers: ["đăng"], area: "Đăng bài" }),
      candidate({ id: "quota-question", name: "quota-question", description: "quota hạn mức", triggers: ["quota"], area: "Mô hình AI" }),
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.hits[0]?.id).toBe("publish-project");
    expect(parts[1]?.hits[0]?.id).toBe("quota-question");
  });

  it("smooths historical success inside 30 days and starts a new skill at 0.5", () => {
    const now = new Date("2026-11-05T00:00:00.000Z");
    expect(historicalSuccess([], now, "new")).toBe(0.5);
    const score = historicalSuccess([
      { id: "publish-project", at: "2026-11-01T00:00:00.000Z", outcome: "success" },
      { id: "publish-project", at: "2026-10-01T00:00:00.000Z", outcome: "failed" },
      { id: "other", at: "2026-11-02T00:00:00.000Z", outcome: "success" },
    ], now, "publish-project");
    expect(score).toBeCloseTo(2 / 3);
  });
});

describe("operator skills and snapshot", () => {
  it("validates generated skills and keeps the handbook to the index", () => {
    const names = new Set(Object.keys(ASSISTANT_TOOLS));
    for (const skill of OPERATOR_SKILLS) {
      expect(validateSkillMarkdown(renderSkillMarkdown(skill), names)).toEqual([]);
    }
    const handbook = renderHandbook({
      tools: [{ name: "list_projects", description: "Liệt kê dự án", risk: "read" }],
      skills: OPERATOR_SKILLS,
      duties: [],
      snapshot: "Hồ sơ: không.",
    });
    expect(handbook).toContain("publish-project:");
    expect(handbook).not.toContain("Kiểm tra tài khoản đã kết nối trước khi tạo lượt đăng.");
    expect(handbook).toContain("find_skills");
  });

  it("shrinks a long snapshot to counts", () => {
    const text = renderSnapshot({
      profiles: Array.from({ length: 20 }, (_, index) => ({ name: `Hồ sơ rất dài số ${index}`, automation: index % 2 === 0 })),
      waitingGates: 4,
      orderCount: 2,
      quotaLine: "chính sách wait, 9 quy tắc.",
    }, 80);
    expect(text.length).toBeLessThanOrEqual(220);
    expect(text).toContain("Dùng công cụ");
    expect(text).not.toContain("Hồ sơ rất dài số 19");
  });
});

describe("successive elimination", () => {
  it("drops a clearly worse candidate and never drops the leader", () => {
    const result = runSuccessiveElimination({
      candidates: ["tot", "kem"],
      cases: ["a", "b", "c", "d", "e", "f"],
      warmup: 2,
      callCap: 20,
      evaluate: (candidate) => candidate === "tot",
    });
    expect(result.dropped).toContain("kem");
    expect(result.dropped).not.toContain("tot");
    expect(result.leader).toBe("tot");
    expect(result.calls).toBeLessThan(12);
    expect(result.saved).toBeGreaterThan(0);
  });

  it("stops at the call cap", () => {
    const result = runSuccessiveElimination({
      candidates: ["a", "b", "c"],
      cases: ["1", "2", "3", "4", "5"],
      callCap: 3,
      evaluate: () => true,
    });
    expect(result.calls).toBeLessThanOrEqual(3);
  });

  it("reuses cached evaluations", () => {
    const cache = new Map<string, boolean>();
    const first = runSuccessiveElimination({
      candidates: ["a", "b"],
      cases: ["1", "2", "3", "4"],
      callCap: 20,
      cache,
      evaluate: () => true,
    });
    expect(first.calls).toBeGreaterThan(0);
    let extra = 0;
    const second = runSuccessiveElimination({
      candidates: ["a", "b"],
      cases: ["1", "2", "3", "4"],
      callCap: 20,
      cache,
      evaluate: () => {
        extra += 1;
        return false;
      },
    });
    expect(extra).toBe(0);
    expect(second.cacheHits).toBeGreaterThan(0);
  });
});
