import { mkdirSync } from "node:fs";
import type { DraftRunner } from "./proposalDraft.js";

// TASK-074c-3c-2b: wiring for the draft route. The option comes from the server wiring (index.ts) and the runner factory
// from app.ts. buildApp with no option gives undefined, so the route answers 503.
// Live only on the caller-supplied-runner path: that path returns the caller's own object, so the route reads root and
// runner at request time (the route test swaps both per test). The factory path takes a snapshot at buildApp time; that
// is fine because production passes a constant root.

export type ProposalDraftOption = { root: string; runner?: DraftRunner; ensureRoot?: (root: string) => void };
export type ProposalDraftDeps = { root: string; runner: DraftRunner; ensureRoot?: (root: string) => void };

function hasRunner(option: ProposalDraftOption): option is ProposalDraftOption & { runner: DraftRunner } {
  return option.runner !== undefined;
}

export function resolveProposalDraft(
  option: ProposalDraftOption | undefined, makeRunner: () => DraftRunner,
): ProposalDraftDeps | undefined {
  if (!option) return undefined;
  if (hasRunner(option)) return option;
  return {
    root: option.root,
    runner: makeRunner(),
    ...(option.ensureRoot ? { ensureRoot: option.ensureRoot } : {}),
  };
}

// Non-recursive: creates only the leaf. A missing parent (ENOENT) and an existing directory (EEXIST) are both swallowed,
// and checkProposalTarget then decides (bad_root or ok). It never creates the parent chain.
export function ensureProposalRoot(root: string): void {
  try {
    mkdirSync(root);
  } catch {
    // Intentionally silent: the target check that follows is the only judge of the root.
  }
}
