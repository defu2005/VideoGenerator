import { AsyncLocalStorage } from "node:async_hooks";
import type { StageContext } from "./stageExecutor.js";

export type ActivityKind = "child" | "llm" | "quota";

export interface ActivityReport {
  childAlive?: boolean | null;
  childNote?: string | null;
  llmInFlight?: boolean | null;
  quotaWait?: boolean | null;
}

const stageContextStorage = new AsyncLocalStorage<StageContext>();

/** Thread context through the async execution tree without globals (TASK-131). */
export function runWithStageContext<T>(context: StageContext, fn: () => T): T {
  return stageContextStorage.run(context, fn);
}

/** Get the stage context active on this async call stack, if any. */
export function currentStageContext(): StageContext | undefined {
  return stageContextStorage.getStore();
}

/**
 * Throttle activity reports to at most one per 5 seconds per kind (child, llm, quota),
 * while immediately passing changes in state (TASK-131).
 */
export function createThrottledActivityReporter(
  sink: (activity: ActivityReport) => void,
  throttleMs = 5000,
  now: () => number = () => Date.now(),
): (activity: ActivityReport) => void {
  const lastState: {
    child?: { time: number; alive: boolean | null; note?: string | null };
    llm?: { time: number; inFlight: boolean | null };
    quota?: { time: number; waiting: boolean | null };
  } = {};

  return function report(activity: ActivityReport): void {
    const ts = now();
    const payload: ActivityReport = {};
    let send = false;

    if (activity.childAlive !== undefined) {
      const prev = lastState.child;
      const stateChanged = !prev || prev.alive !== activity.childAlive;
      const timeElapsed = prev ? ts - prev.time >= throttleMs : true;
      if (stateChanged || timeElapsed) {
        payload.childAlive = activity.childAlive;
        payload.childNote = activity.childNote ?? null;
        lastState.child = { time: ts, alive: activity.childAlive, note: activity.childNote ?? null };
        send = true;
      }
    }

    if (activity.llmInFlight !== undefined) {
      const prev = lastState.llm;
      const stateChanged = !prev || prev.inFlight !== activity.llmInFlight;
      const timeElapsed = prev ? ts - prev.time >= throttleMs : true;
      if (stateChanged || timeElapsed) {
        payload.llmInFlight = activity.llmInFlight;
        lastState.llm = { time: ts, inFlight: activity.llmInFlight };
        send = true;
      }
    }

    if (activity.quotaWait !== undefined) {
      const prev = lastState.quota;
      const stateChanged = !prev || prev.waiting !== activity.quotaWait;
      const timeElapsed = prev ? ts - prev.time >= throttleMs : true;
      if (stateChanged || timeElapsed) {
        payload.quotaWait = activity.quotaWait;
        lastState.quota = { time: ts, waiting: activity.quotaWait };
        send = true;
      }
    }

    if (send) {
      sink(payload);
    }
  };
}

/**
 * Call context.reportActivity from anywhere in the call stack.
 * If explicit context is given, uses it; otherwise falls back to currentStageContext().
 * If neither is available (in tests or tools outside a stage run), it's a silent no-op.
 */
export function reportStageActivity(activity: ActivityReport, explicitContext?: StageContext | null): void {
  const ctx = explicitContext ?? currentStageContext();
  ctx?.reportActivity?.(activity);
}
