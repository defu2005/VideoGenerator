import { z } from "zod";
import { KnowledgeEntrySchema, MarketKnowledgeSchema } from "./schema.js";

const legacyLimit = z.object({
  platform: z.string(), name: z.string(), value: z.number(), unit: z.string().optional(),
  endpoint: z.string().optional(),
});

export function parseKnowledgeImport(input: unknown) {
  let candidate = input;
  if (input && typeof input === "object" && "kind" in input && input.kind === "platform_limit" && "value" in input) {
    const parsed = legacyLimit.safeParse(input.value);
    if (parsed.success) {
      const { endpoint, ...value } = parsed.data;
      const evidence = "evidence" in input && Array.isArray(input.evidence) ? input.evidence : [];
      const api = evidence.some((source) =>
        (typeof source?.quote === "string" && /\b(?:GET|POST|PATCH|DELETE|PUT)\s+\//.test(source.quote))
        || (typeof source?.url === "string" && (endpoint ? source.url.includes(endpoint) :
          /developers\.google\.com\/youtube\/(?:data\/reference\/rest\/v3|v3\/docs)\/[^/]+\/[^/]+/.test(source.url))));
      candidate = { ...input, kind: "platform_capability", value: { ...value, api } };
    }
  } else if (input && typeof input === "object" && !("kind" in input)) {
    const parsed = MarketKnowledgeSchema.safeParse(input);
    if (parsed.success) {
      const value = parsed.data;
      candidate = {
        id: `market.${value.code}`, kind: "market", scope: { platforms: ["*"], markets: [value.code] },
        value, evidence: value.sources.map((url) => ({ url, checkedAt: value.checkedAt, type: "inference" })),
        confidence: "medium", volatility: "monthly", watch: value.watch ?? [], status: "active",
      };
    }
  }
  return KnowledgeEntrySchema.safeParse(candidate);
}
