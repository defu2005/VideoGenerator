import { z } from "zod";
import { GuidelinePackSchema } from "../guidelines/schema.js";
import { MarketCodeSchema, MarketPackSchema } from "../markets/schema.js";

export const KnowledgeDaySchema = z.iso.date();
const httpUrl = z.url({ protocol: /^https?$/ });
const name = z.string().trim().min(1);
const strings = z.array(z.string());
const nullableText = z.string().nullable();
const scopeList = (item: z.ZodString) => z.union([z.tuple([z.literal("*")]), z.array(item).min(1)]);
export const KnowledgeIdSchema = z.string().max(180).regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/);
const platform = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const market = MarketCodeSchema;

export const PublisherCapabilitySchema = z.object({
  maxDurationSec: z.number().positive(), maxTitleChars: z.number().int().positive(),
  maxDescriptionChars: z.number().int().positive(), maxTagChars: z.number().int().positive(),
});
export const KnowledgeQuotaSchema = z.object({
  bucket: name, unit: name, cost: z.number().int().positive(), limit: z.number().int().positive(),
  window: z.literal("day"), reset: z.literal("America/Los_Angeles"),
});
export const ApiContractSchema = z.looseObject({
  name, endpoint: nullableText, scopes: strings.nullable(), quotaCost: z.number().nonnegative().nullable(),
  quota: KnowledgeQuotaSchema.optional(),
  methodCosts: z.record(z.string(), z.number().int().positive()).optional(),
  privacyMismatch: name.optional(),
});
export const MarketKnowledgeSchema = MarketPackSchema;

export const KNOWLEDGE_VALUES = {
  guideline_pack: GuidelinePackSchema,
  market: MarketKnowledgeSchema,
  monetization_program: z.looseObject({
    platform, name, pays: name, eligibility: z.looseObject({ text: name }),
    share: nullableText, countries: scopeList(market).or(z.tuple([])).nullable(),
    contentRules: name, automatedUse: z.enum(["yes", "partly", "no"]).nullable(), reason: nullableText,
  }),
  platform_capability: z.object({ platform, name, value: z.json(), unit: name.optional(), api: z.boolean() }),
  api_contract: ApiContractSchema,
  provider_terms: z.looseObject({
    provider: name, availability: z.boolean().nullable().optional(), licence: nullableText.optional(),
    attribution: nullableText.optional(), caching: nullableText.optional(), price: z.json().optional(),
  }),
  law: z.looseObject({ country: market, scope: name, requires: name }),
  account_policy: z.looseObject({ platform, name, signal: name, coverage: z.enum(["api", "partial", "manual"]), verification: name }),
  dependency: z.looseObject({ name, version: nullableText.optional(), availability: z.boolean().nullable().optional() }),
  creator_tactic: z.object({ name, summary: name, kpi: name, howToAutomate: name,
    metricBaseline: z.object({ metric: name, definition: name, format: name, min: z.number(), max: z.number(),
      observed: z.object({ accountId: name, mean: z.number(), from: KnowledgeDaySchema, to: KnowledgeDaySchema, samples: z.number().int().positive() }).optional(),
    }).refine(v => v.min <= v.max, "Khoảng tham chiếu phải tăng dần.").optional(),
  }),
};
export const KnowledgeKindSchema = z.enum(Object.keys(KNOWLEDGE_VALUES) as [keyof typeof KNOWLEDGE_VALUES, ...(keyof typeof KNOWLEDGE_VALUES)[]]);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;
export const KnowledgeEvidenceSchema = z.object({
  url: httpUrl, checkedAt: KnowledgeDaySchema, sourceUpdatedAt: KnowledgeDaySchema.optional(),
  quote: name.refine((v) => v.split(/\s+/).length <= 25).optional(),
  type: z.enum(["official", "industry", "measured", "anecdote", "inference"]),
}).strict();
export const KnowledgeWatchSchema = z.object({ url: httpUrl, kind: z.enum(["policy_page", "changelog", "rss", "api_revision"]) }).strict();
export const KnowledgeVolatilitySchema = z.enum(["stable", "yearly", "quarterly", "monthly", "weekly"]);
export const KnowledgeFreshnessSchema = z.enum(["fresh", "due", "stale"]);
export const KnowledgeEntrySchema = z.object({
  id: KnowledgeIdSchema, kind: KnowledgeKindSchema,
  scope: z.object({ platforms: scopeList(platform), markets: scopeList(market) }).strict(),
  value: z.json(), evidence: z.array(KnowledgeEvidenceSchema).min(1),
  confidence: z.enum(["high", "medium", "low"]), volatility: KnowledgeVolatilitySchema,
  watch: z.array(KnowledgeWatchSchema), status: z.enum(["active", "deprecated"]),
  supersedes: KnowledgeIdSchema.optional(), validFrom: KnowledgeDaySchema.optional(),
  validUntil: KnowledgeDaySchema.optional(), notes: z.string().optional(),
}).strict().superRefine((entry, ctx) => {
  const parsed = KNOWLEDGE_VALUES[entry.kind].safeParse(entry.value);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: "custom", path: ["value", ...issue.path], message: issue.message });
  }
  if (entry.validFrom && entry.validUntil && entry.validFrom >= entry.validUntil) {
    ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Ngày kết thúc phải sau ngày bắt đầu." });
  }
  if (entry.kind === "guideline_pack" && parsed.success && entry.id !== `guideline.${(parsed.data as { id: string }).id}`) {
    ctx.addIssue({ code: "custom", path: ["id"], message: "ID phải khớp với bộ guideline." });
  }
  if (entry.kind === "market" && parsed.success && entry.id !== `market.${(parsed.data as { code: string }).code}`) {
    ctx.addIssue({ code: "custom", path: ["id"], message: "ID phải khớp với mã thị trường." });
  }
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;
export type KnowledgeFreshness = z.infer<typeof KnowledgeFreshnessSchema>;
export const KnowledgeFilterSchema = z.object({
  kind: KnowledgeKindSchema.optional(), platform: platform.optional(), market: market.optional(),
  freshness: KnowledgeFreshnessSchema.optional(),
});
export type KnowledgeFilter = z.infer<typeof KnowledgeFilterSchema>;
export const KnowledgeImportSchema = z.object({ entries: z.array(z.unknown()).max(1000), label: name.max(200) }).strict();
export const KnowledgeProposalInputSchema = z.object({ entry: KnowledgeEntrySchema, reason: name.max(500) }).strict();
export const KnowledgeDecisionSchema = z.object({ reason: name.max(500).optional() }).strict();
export const KnowledgeRollbackSchema = z.object({ revision: z.number().int().nonnegative(), reason: name.max(500).optional() }).strict();
