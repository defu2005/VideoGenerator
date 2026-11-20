import type { Job } from "@vg/shared";
import type { StageAgentAdapter } from "./types.js";
import { SCRIPT_HANDOFF_ERRORS, type AgentScriptToolkit } from "../scriptToolkit.js";

export type ScriptAdapterDeps = {
  script: Pick<AgentScriptToolkit, "context" | "validateComplete">;
};

/** TASK-147d: the SCRIPT stage's agent lead role. The app keeps execution "app" by default; an agent takes the job only when it claims it. */
export function createScriptAdapter(deps: ScriptAdapterDeps): StageAgentAdapter {
  return {
    stage: "SCRIPT",
    role: "script_writer",
    handoffErrors: SCRIPT_HANDOFF_ERRORS,
    buildContext: (job: Job) => deps.script.context(job),
    validateComplete: (job: Job) => {
      deps.script.validateComplete(job);
    },
  };
}
