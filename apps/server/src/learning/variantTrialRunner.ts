import type Database from "better-sqlite3";
import { recordTrialEvidence, trialVerdict, type TrialEvidence, type VariantRow } from "./promptVariants.js";

export type BlindWinner = "A" | "B" | "TIE";

/**
 * TASK-148e: runs one blind trial per fixture for a candidate prompt variant against the baseline.
 * The judge sees two scripts in random order and returns which one is better; this function maps
 * the answer back to the variant before recording. The judge is injected, so tests run without an LLM.
 */
export async function runVariantTrials(
  db: Database.Database,
  input: {
    variantId: string;
    fixtureIds: string[];
    judge: (fixtureId: string, variantIsA: boolean) => Promise<BlindWinner>;
    random?: () => number;
    now?: Date;
  },
): Promise<{ row: VariantRow; verdict: ReturnType<typeof trialVerdict>; trials: TrialEvidence[] }> {
  const random = input.random ?? Math.random;
  const at = (input.now ?? new Date()).toISOString();
  const trials: TrialEvidence[] = [];
  for (const fixtureId of input.fixtureIds) {
    const variantIsA = random() < 0.5;
    const blind = await input.judge(fixtureId, variantIsA);
    // Map the blind answer back to the variant: "A" is the variant only when it was shown as A.
    const winner: BlindWinner = blind === "TIE" ? "TIE" : (blind === "A") === variantIsA ? "A" : "B";
    trials.push({ fixtureId, winner, at });
  }
  const row = recordTrialEvidence(db, input.variantId, trials);
  return { row, verdict: trialVerdict(row.evidence), trials };
}
