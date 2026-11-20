import { operatorToolHooks } from "./hooks.js";

/**
 * TASK-074c-2 pre-check: a run must call find_tools and find_skills before it can
 * propose a missing tool. Keyed only on the operator run id; a call without a run id
 * (MCP without a managed invocation, direct API) is not gated.
 *
 * In memory only: a server restart forces the model to repeat both checks in a run.
 */
export type RouteCheck = "find_tools" | "find_skills";
export const ROUTE_CHECKS: readonly RouteCheck[] = ["find_tools", "find_skills"];
/** Bounds the map so a long-lived server cannot grow it without limit. */
export const MAX_ROUTE_CHECK_RUNS = 500;

const checksByRun = new Map<string, Set<RouteCheck>>();

/** Record a check after its hook returned, so a failed search does not count. */
export function recordRouteCheck(runId: string, check: RouteCheck): void {
  const checks = checksByRun.get(runId) ?? new Set<RouteCheck>();
  checksByRun.delete(runId);
  checks.add(check);
  checksByRun.set(runId, checks);
  while (checksByRun.size > MAX_ROUTE_CHECK_RUNS) {
    const oldest = checksByRun.keys().next().value;
    if (oldest === undefined) break;
    checksByRun.delete(oldest);
  }
}

export function missingRouteChecks(runId: string): RouteCheck[] {
  const checks = checksByRun.get(runId);
  return ROUTE_CHECKS.filter((check) => !checks?.has(check));
}

/**
 * Refusal message when the run still owes a check, or null when the proposal may go through.
 * No run id, or no operator hooks (find_tools and find_skills would fail with 503 anyway), means no gate.
 */
export function routeCheckRefusal(runId: string | null | undefined): string | null {
  if (!runId || !operatorToolHooks()) return null;
  const missing = missingRouteChecks(runId);
  if (missing.length === 0) return null;
  return `Cần gọi ${missing.join(" và ")} trong lượt này trước khi đề xuất công cụ.`;
}
