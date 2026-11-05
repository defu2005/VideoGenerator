import { createHash } from "node:crypto";

/**
 * Successive elimination for comparing K models.
 * Idea from AgentOptimizer/agentopt (Apache-2.0): warm-up, then drop a
 * candidate whose upper bound falls below the leader's lower bound.
 * Written here; no code is copied.
 */

export type EvalCacheKeyInput = {
  model: string;
  messages: unknown;
  params: unknown;
};

export function evalCacheKey(input: EvalCacheKeyInput): string {
  return createHash("sha256").update(stable(input)).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function bounds(successes: number, trials: number): { low: number; high: number } {
  if (trials <= 0) return { low: 0, high: 1 };
  const mean = successes / trials;
  const se = Math.sqrt(Math.max(0, (mean * (1 - mean)) / trials));
  return {
    low: Math.max(0, mean - 1.96 * se),
    high: Math.min(1, mean + 1.96 * se),
  };
}

export type EliminationResult = {
  leader: string;
  calls: number;
  saved: number;
  dropped: string[];
  cacheHits: number;
};

export function runSuccessiveElimination(input: {
  candidates: string[];
  cases: string[];
  warmup?: number;
  callCap: number;
  evaluate: (candidate: string, caseId: string) => boolean;
  cache?: Map<string, boolean>;
}): EliminationResult {
  const warmup = input.warmup ?? 2;
  const cases = input.cases.length > 0 ? input.cases : ["case-1"];
  const stats = input.candidates.map((id) => ({ id, success: 0, n: 0, dropped: false }));
  let calls = 0;
  let cacheHits = 0;

  function leader() {
    const alive = stats.filter((item) => !item.dropped);
    alive.sort((a, b) => {
      const aMean = a.n ? a.success / a.n : 0;
      const bMean = b.n ? b.success / b.n : 0;
      return bMean - aMean || a.id.localeCompare(b.id);
    });
    return alive[0];
  }

  function eliminate(): void {
    const lead = leader();
    if (!lead || lead.n === 0) return;
    const low = bounds(lead.success, lead.n).low;
    for (const stat of stats) {
      if (stat.dropped || stat.id === lead.id || stat.n === 0) continue;
      if (bounds(stat.success, stat.n).high < low) stat.dropped = true;
    }
  }

  function sample(stat: (typeof stats)[number]): void {
    if (calls >= input.callCap || stat.n >= cases.length) return;
    const caseId = cases[stat.n] ?? cases[cases.length - 1]!;
    const key = evalCacheKey({ model: stat.id, messages: caseId, params: { suite: "operator-eval" } });
    let ok: boolean;
    if (input.cache?.has(key)) {
      ok = input.cache.get(key) === true;
      cacheHits += 1;
    } else {
      if (calls >= input.callCap) return;
      ok = input.evaluate(stat.id, caseId);
      calls += 1;
      input.cache?.set(key, ok);
    }
    stat.n += 1;
    if (ok) stat.success += 1;
  }

  for (let round = 0; round < warmup; round += 1) {
    for (const stat of stats) {
      if (calls >= input.callCap) break;
      sample(stat);
    }
  }
  eliminate();
  while (calls < input.callCap && stats.filter((item) => !item.dropped).length > 1) {
    const alive = stats.filter((item) => !item.dropped && item.n < cases.length);
    if (alive.length === 0) break;
    alive.sort((a, b) => bounds(b.success, b.n).high - bounds(a.success, a.n).high || a.id.localeCompare(b.id));
    const before = calls;
    sample(alive[0]!);
    if (calls === before && !input.cache) break;
    if (alive[0]!.n >= cases.length && calls === before) break;
    eliminate();
    if (calls === before) break;
  }

  const lead = leader();
  const full = input.candidates.length * cases.length;
  return {
    leader: lead?.id ?? input.candidates[0] ?? "",
    calls,
    saved: Math.max(0, full - calls),
    dropped: stats.filter((item) => item.dropped).map((item) => item.id),
    cacheHits,
  };
}
