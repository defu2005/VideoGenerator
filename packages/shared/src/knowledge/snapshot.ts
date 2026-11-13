import { KnowledgeEntrySchema, type KnowledgeEntry, type KnowledgeKind } from "./schema.js";
import guideline_pack from "./snapshot/guideline_pack.json" with { type: "json" };
import market from "./snapshot/market.json" with { type: "json" };
import monetization_program from "./snapshot/monetization_program.json" with { type: "json" };
import platform_capability from "./snapshot/platform_capability.json" with { type: "json" };
import api_contract from "./snapshot/api_contract.json" with { type: "json" };
import provider_terms from "./snapshot/provider_terms.json" with { type: "json" };
import law from "./snapshot/law.json" with { type: "json" };
import account_policy from "./snapshot/account_policy.json" with { type: "json" };
import dependency from "./snapshot/dependency.json" with { type: "json" };
import creator_tactic from "./snapshot/creator_tactic.json" with { type: "json" };

const files: Record<KnowledgeKind, unknown[]> = {
  guideline_pack, market, monetization_program, platform_capability, api_contract,
  provider_terms, law, account_policy, dependency, creator_tactic,
};

export const KNOWLEDGE_SNAPSHOT = Object.entries(files).flatMap(([kind, rows]) =>
  rows.map((row) => {
    const entry = KnowledgeEntrySchema.parse(row);
    if (entry.kind !== kind) throw new Error(`Unexpected kind in knowledge snapshot: ${entry.id}`);
    return entry;
  }),
);

const byId = new Map(KNOWLEDGE_SNAPSHOT.map((entry) => [entry.id, entry]));
if (byId.size !== KNOWLEDGE_SNAPSHOT.length) throw new Error("Duplicate knowledge snapshot ID");

export function snapshotKnowledge(id: string): KnowledgeEntry | undefined {
  return byId.get(id);
}
