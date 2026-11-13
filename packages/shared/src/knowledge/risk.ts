import { GuidelinePackSchema } from "../guidelines/schema.js";
import { diffJson, type JsonPatchOperation } from "./diff.js";
import type { KnowledgeEntry } from "./schema.js";

export type KnowledgeRisk = "low" | "medium" | "high";

export function knowledgeRisk(
  before: KnowledgeEntry | null, after: KnowledgeEntry, patch: JsonPatchOperation[],
): KnowledgeRisk {
  if (after.evidence.some((e) => e.type === "measured")) return "high";
  if (before && patch.every(({ path }) => /^\/(?:notes|evidence)(?:\/|$)/.test(path))) return "low";
  if (["law", "account_policy", "platform_capability", "api_contract", "monetization_program"].includes(after.kind)) return "high";
  if (after.kind === "market" && (!before || patch.some(({ path }) => /^\/value\/(?:platforms|monetization|rules)(?:\/|$)/.test(path)))) return "high";
  if (after.kind === "provider_terms" && patch.some(({ path }) =>
    path === "" || /^\/value(?:$|\/(?:availability|available|licence|license)(?:\/|$))/.test(path))) return "high";
  if (after.kind === "guideline_pack") {
    const old = before ? GuidelinePackSchema.parse(before.value) : null;
    const next = GuidelinePackSchema.parse(after.value);
    if (before && patch.some(({ path }) => /^\/(?:scope|status|validFrom|validUntil|supersedes|value\/params)(?:\/|$)/.test(path))) return "high";
    const changes = [...new Set([...next.rules, ...(old?.rules ?? [])].map((rule) => rule.id))].flatMap((id) => {
      const previous = old?.rules.filter((rule) => rule.id === id) ?? [];
      const proposed = next.rules.filter((rule) => rule.id === id);
      return diffJson(previous, proposed).length ? [...previous, ...proposed].map((rule) => rule.severity) : [];
    });
    if (changes.includes("MUST")) return "high";
    if (changes.includes("SHOULD")) return "medium";
    return "low";
  }
  return "medium";
}
