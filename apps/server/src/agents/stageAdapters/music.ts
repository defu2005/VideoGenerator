import type { Job } from "@vg/shared";
import type { StageAgentAdapter } from "./types.js";
import { MUSIC_HANDOFF_ERRORS, type AgentMusicToolkit } from "../musicToolkit.js";

export type MusicAdapterDeps = {
  music: Pick<AgentMusicToolkit, "context" | "validateComplete" | "prepareComplete">;
};

export function createMusicAdapter(deps: MusicAdapterDeps): StageAgentAdapter {
  return {
    stage: "MUSIC_SEARCH",
    role: "music_scout",
    handoffErrors: MUSIC_HANDOFF_ERRORS,
    buildContext: (job: Job) => deps.music.context(job),
    validateComplete: (job: Job) => {
      deps.music.validateComplete(job);
    },
    prepareComplete: (job: Job) => deps.music.prepareComplete(job),
  };
}
