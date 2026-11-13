import { z } from "zod";

export const EvidenceSourceSchema = z.enum([
  "public_docs",
  "omniroute",
  "user_checked",
  "user_report",
  "independent",
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export function evidencedSchema<T extends z.ZodType>(inner: T) {
  return z.object({
    value: z.union([inner, z.literal("UNKNOWN")]),
    sourceUrl: z.string().min(1).optional(),
    quote: z.string().max(400).optional(),
    source: EvidenceSourceSchema,
    verifiedAt: z.string().min(4).optional(),
  }).strict().superRefine((field, context) => {
    const row = field as { value?: unknown; sourceUrl?: string; verifiedAt?: string };
    if (row.value === "UNKNOWN") return;
    if (!row.sourceUrl) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceUrl"], message: "sourceUrl required" });
    }
    if (!row.verifiedAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["verifiedAt"], message: "verifiedAt required" });
    }
  });
}

export type Evidenced<T> = {
  value: T | "UNKNOWN";
  sourceUrl?: string;
  quote?: string;
  source: EvidenceSource;
  verifiedAt?: string;
};

const yesNo = evidencedSchema(z.enum(["yes", "no"]));
const yesNoNa = evidencedSchema(z.enum(["yes", "no", "not_applicable"]));
const evidencedString = evidencedSchema(z.string().min(1));
const evidencedBool = evidencedSchema(z.boolean());

export const ProviderCategorySchema = z.enum([
  "llm", "embedding", "rerank", "image", "video", "tts", "stt", "gpu", "cloud", "aggregator",
]);
export type ProviderCategory = z.infer<typeof ProviderCategorySchema>;

export const OfferKindSchema = z.enum([
  "permanent_free",
  "monthly_free",
  "daily_free",
  "signup_credit",
  "promo_credit",
  "referral_credit",
  "startup_credit",
  "grant",
  "free_models_rate_limited",
  "chatbot_only_not_api",
]);
export type OfferKind = z.infer<typeof OfferKindSchema>;

export const OfferUnitSchema = z.enum(["usd", "tokens", "requests", "credits", "gpu_hours"]);
export const OfferAppliesToSchema = z.enum(["api_inference", "cloud_other", "chat_ui"]);
export const OfferStatusSchema = z.enum(["active", "expired", "unverified"]);
export const ExhaustionSchema = z.enum([
  "HARD_STOP", "SOFT_STOP", "AUTO_TOPUP", "POSTPAID", "SUBSCRIPTION_CONVERSION", "UNKNOWN",
]);
export const BillingRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const RiskFlagSchema = z.enum([
  "LEGAL_RISK",
  "PRIVACY_RISK",
  "BILLING_RISK",
  "BILLING_UNVERIFIED",
  "REGION_RESTRICTION",
  "UNVERIFIED_COMPANY",
  "PROMOTIONAL_ONLY",
  "NO_API_ACCESS",
  "NONCOMMERCIAL_ONLY",
  "SECURITY_INCIDENT",
  "ACCOUNT_SUSPENSION_RISK",
]);
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const AccountStatusSchema = z.enum([
  "CONFIGURED",
  "AUTHENTICATED",
  "CONNECTED",
  "MODEL_DISCOVERED",
  "CALLABLE",
  "RATE_LIMITED",
  "QUOTA_EXHAUSTED",
  "EXPIRED",
  "INVALID_CREDENTIALS",
  "UNKNOWN",
]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const BenefitConditionSchema = z.enum([
  "permanent",
  "time_limited",
  "one_time",
  "monthly",
  "needs_payment_verification",
  "needs_kyc",
  "company_only",
]);
export const BenefitEligibilitySchema = z.enum([
  "in_account",
  "needs_manual_activation",
  "needs_user_approval",
  "advertised_unconfirmed",
  "expired",
]);
export const EcosystemServiceSchema = z.enum([
  "llm_api", "gpu", "vps", "object_storage", "database", "kubernetes", "serverless",
  "image", "video", "speech", "agent_sandbox", "developer_credits",
]);

export const ProviderStubSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  website: z.string().url(),
  categories: z.array(ProviderCategorySchema).min(1),
  needsResearch: z.literal(true),
  discoveredFrom: z.string().min(1).max(200).optional(),
}).strict();
export type ProviderStub = z.infer<typeof ProviderStubSchema>;

export const OfferSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  kind: OfferKindSchema,
  amount: evidencedSchema(z.number()),
  unit: OfferUnitSchema,
  rpm: evidencedSchema(z.number()),
  tpm: evidencedSchema(z.number()),
  rpd: evidencedSchema(z.number()),
  context: evidencedSchema(z.number()),
  models: z.array(z.string()),
  expiresAt: z.string().nullable(),
  requirements: z.array(z.string()),
  appliesTo: OfferAppliesToSchema,
  status: OfferStatusSchema,
  note: z.string().optional(),
}).strict();
export type ProviderOffer = z.infer<typeof OfferSchema>;

export const EcosystemBenefitSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  service: EcosystemServiceSchema,
  available: evidencedBool,
  freeQuota: evidencedString,
  expiry: evidencedString,
  cardRequired: yesNo,
  autoBillingRisk: evidencedString,
  condition: BenefitConditionSchema,
}).strict();
export type EcosystemBenefit = z.infer<typeof EcosystemBenefitSchema>;

export const BillingSchema = z.object({
  mode: evidencedSchema(z.enum(["free", "prepaid", "postpaid", "subscription", "payg"])),
  cardRequired: yesNo,
  authHold: z.object({
    exists: yesNo,
    amount: evidencedString,
    captured: yesNo,
  }).strict(),
  autoTopup: z.object({
    defaultOn: yesNo,
    canDisable: yesNo,
    trigger: evidencedString,
    min: evidencedString,
    max: evidencedString,
  }).strict(),
  thresholdBilling: z.object({
    exists: yesNo,
    defaultUsd: evidencedString,
    autoRaise: yesNo,
  }).strict(),
  recurringSubscription: yesNo,
  trialAutoConverts: yesNo,
  postpaidCollectsOutstanding: yesNo,
  exhaustionBehaviour: evidencedSchema(ExhaustionSchema),
  spendingControls: z.object({
    hardCap: evidencedBool,
    monthlyCap: evidencedBool,
    perProject: evidencedBool,
    perKey: evidencedBool,
    perModel: evidencedBool,
    alerts: evidencedBool,
    autoSuspend: evidencedBool,
    keyRevocation: evidencedBool,
    cardRemoval: evidencedBool,
  }).strict(),
  revokingKeyStopsCharges: yesNo,
  stoppingRequestsStopsCharges: yesNo,
  safestZeroSpendConfigVi: evidencedString,
  answers: z.object({
    canChargeAutomatically: yesNo,
    chargeTrigger: evidencedString,
    canDisableAutoCharge: yesNoNa,
    paidContinuesAfterFree: yesNo,
    collectsOutstanding: yesNo,
    hardSpendingLimit: yesNo,
    deletingKeyStopsCharges: yesNo,
    stoppingRequestsStopsCharges: yesNo,
    activeSubscriptions: yesNo,
    safestZeroSpend: evidencedString,
  }).strict(),
  riskLevel: BillingRiskLevelSchema,
  unverified: z.boolean(),
}).strict();
export type ProviderBilling = z.infer<typeof BillingSchema>;

export const ProviderRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  website: z.string().url(),
  categories: z.array(ProviderCategorySchema).min(1),
  needsResearch: z.boolean(),
  discoveredFrom: z.string().optional(),
  legalEntity: evidencedString,
  country: evidencedString,
  parentCompany: evidencedString,
  legitimacy: z.object({
    grade: z.enum(["A", "B", "C", "D", "UNKNOWN"]),
    reason: z.string(),
  }).strict(),
  api: z.object({
    protocols: z.array(z.enum(["openai", "anthropic", "native"])),
    baseUrl: evidencedString,
    docsUrl: evidencedString,
  }).strict(),
  tos: z.object({
    summaryVi: z.string(),
    commercialUseAllowed: evidencedBool,
    freeOutputCommercial: evidencedBool,
    agentsAllowed: evidencedBool,
    resaleAllowed: evidencedBool,
    multiAccountBanned: evidencedBool,
    freeQuotaRevocable: evidencedBool,
    creditsExpire: evidencedBool,
    nonProductionOnly: evidencedBool,
    suspendWithoutNotice: evidencedBool,
    geoRestrictions: evidencedString,
    kycRequired: evidencedBool,
    conflictsVi: z.array(z.string()),
    reviewConfidence: z.enum(["normal", "lowered"]),
  }).strict(),
  privacy: z.object({
    trainsOnPrompts: evidencedBool,
    optOut: evidencedBool,
    zeroRetention: evidencedBool,
    retentionDays: evidencedSchema(z.number()),
    dataResidency: evidencedString,
    certifications: z.array(z.string()),
    subprocessorsUrl: evidencedString,
    incidents: z.array(z.object({
      date: z.string(),
      summary: z.string(),
      url: z.string().min(1),
      resolved: z.boolean(),
    }).strict()),
    reviewConfidence: z.enum(["normal", "lowered"]),
  }).strict(),
  vietnam: z.object({
    signupAllowed: evidencedBool,
    vnCardAccepted: evidencedBool,
    needsChinesePhoneOrId: evidencedBool,
    needsBusiness: evidencedBool,
    personalAccountOk: evidencedBool,
  }).strict(),
  billing: BillingSchema,
  scoreInputs: z.object({
    legitimacy: z.enum(["A", "B", "C", "D", "UNKNOWN"]),
    securityPrivacy: z.union([z.number(), z.literal("UNKNOWN")]),
    tosCommercial: z.union([z.number(), z.literal("UNKNOWN")]),
    freeValue: z.union([z.number(), z.literal("UNKNOWN")]),
    vietnam: z.union([z.number(), z.literal("UNKNOWN")]),
    apiCompatibility: z.union([z.number(), z.literal("UNKNOWN")]),
    reliability: z.union([z.number(), z.literal("UNKNOWN")]),
  }).strict(),
  score: z.number(),
  flags: z.array(RiskFlagSchema),
  autoConfigAllowed: z.boolean(),
}).strict();
export type ProviderRecord = z.infer<typeof ProviderRecordSchema>;

export const ProviderDocumentSchema = z.union([ProviderRecordSchema, ProviderStubSchema]);
export type ProviderDocument = z.infer<typeof ProviderDocumentSchema>;

export const AccountBenefitSchema = z.object({
  id: z.string(),
  titleVi: z.string(),
  eligibility: BenefitEligibilitySchema,
  noteVi: z.string(),
}).strict();

export const ProviderAccountSchema = z.object({
  providerId: z.string(),
  omnirouteConnectionIds: z.array(z.string()),
  status: z.array(AccountStatusSchema),
  credentialPresent: z.boolean(),
  lastSuccessAt: z.string().nullable(),
  errors: z.array(z.string()),
  benefits: z.array(AccountBenefitSchema),
  userChecklist: z.array(z.object({
    path: z.string(),
    value: z.string(),
    checkedAt: z.string(),
    source: z.literal("user_checked"),
  }).strict()),
}).strict();
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;

export const CapabilityStateSchema = z.enum(["tested", "documented", "UNKNOWN"]);
export const ModelCapabilitySchema = z.object({
  state: CapabilityStateSchema,
  value: z.boolean(),
}).strict();

export const ProbeErrorKindSchema = z.enum(["auth", "quota", "rate_limit", "outage", "not_found", "other"]);

export const IntelModelSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  aliases: z.array(z.string()),
  deprecated: z.boolean(),
  context: evidencedSchema(z.number()),
  maxOutput: evidencedSchema(z.number()),
  pricing: evidencedString,
  paid: z.boolean(),
  capabilities: z.object({
    streaming: ModelCapabilitySchema,
    tools: ModelCapabilitySchema,
    json: ModelCapabilitySchema,
    vision: ModelCapabilitySchema,
    audio: ModelCapabilitySchema,
    video: ModelCapabilitySchema,
    embedding: ModelCapabilitySchema,
  }).strict(),
  rateLimits: evidencedString,
  cookieConnection: z.boolean(),
  cooldown: z.boolean(),
  quotaLeft: z.union([z.number(), z.literal("UNKNOWN")]),
  lastProbe: z.object({
    at: z.string(),
    ok: z.boolean(),
    latencyMs: z.number(),
    errorKind: ProbeErrorKindSchema.nullable(),
  }).strict().nullable(),
}).strict();
export type IntelModel = z.infer<typeof IntelModelSchema>;

export const AbilityNameSchema = z.enum([
  "vietnamese_writing",
  "vietnamese_understanding",
  "english_writing",
  "reasoning",
  "fact_accuracy",
  "instruction_following",
  "structured_output",
  "tool_calling",
  "long_context",
  "vision_detail",
  "vision_ocr",
  "creativity_storytelling",
  "summarisation",
  "translation",
  "classification",
  "coding",
]);
export type AbilityName = z.infer<typeof AbilityNameSchema>;

export const AbilityGradeSchema = z.object({
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal("UNKNOWN")]),
  source: z.enum(["app_eval", "app_runs", "public", "documented"]).optional(),
  n: z.number().int().nonnegative().optional(),
  measuredAt: z.string().optional(),
}).strict();

export const ModelAbilitiesSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  abilities: z.record(AbilityNameSchema, AbilityGradeSchema),
  ttftMsP50: z.union([z.number(), z.literal("UNKNOWN")]),
  tokensPerSecP50: z.union([z.number(), z.literal("UNKNOWN")]),
  usableContext: z.union([z.number(), z.literal("UNKNOWN")]),
}).strict();
export type ModelAbilities = z.infer<typeof ModelAbilitiesSchema>;

export const BenchmarkResultSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  benchmark: z.string().min(1),
  version: z.string().min(1),
  metric: z.string().min(1),
  value: z.number(),
  sourceUrl: z.string().min(1),
  quote: z.string().min(1),
  measuredAt: z.string().min(4),
  source: z.enum(["model_card", "leaderboard", "paper"]),
}).strict();
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;

export const ProviderIntelExtractSchema = z.object({
  fields: z.array(z.object({
    path: z.string().min(1),
    value: z.string(),
    quote: z.string().min(1),
  }).strict()).max(40),
}).strict();
export type ProviderIntelExtract = z.infer<typeof ProviderIntelExtractSchema>;

export const NEEDS_TOKEN_STEPS_VI = [
  "Mở http://127.0.0.1:20128",
  "Vào Settings, rồi Access Tokens",
  "Tạo token chỉ đọc",
  "Dán token vào ô Quota. Ứng dụng không tự tạo token.",
].join(" ");
