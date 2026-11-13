import { describe, expect, it } from "vitest";
import {
  BENCHMARK_STALE_DAYS,
  LLM_TASKS,
  PROVIDER_STUBS,
  ProviderStubSchema,
  acceptExtractedFields,
  autoConfigAllowed,
  benchmarkApplies,
  benchmarkComponent,
  billingAssessment,
  blankProvider,
  capabilityFromEvidence,
  connectionProbeAllowed,
  connectionStates,
  everyTaskHasAbilities,
  exhaustionIsHardStop,
  hostAllowed,
  knownEvidence,
  missingEvidence,
  modelScorecard,
  offerCountsAsApi,
  overviewQuestions,
  partitionOffers,
  probeAllowedToday,
  quoteInPage,
  recommendProfile,
  robotsDisallows,
  scoreProvider,
  type BenchmarkResult,
  type BillingFacts,
  type ProviderOffer,
  type ScorecardModel,
} from "../src/index.js";
import { ROUTING_PROFILES } from "../src/providerIntel/routing.js";

const lowFacts = (): BillingFacts => ({
  canChargeAutomatically: "no",
  chargeTrigger: "không có",
  canDisableAutoCharge: "not_applicable",
  paidContinuesAfterFree: "no",
  collectsOutstanding: "no",
  hardSpendingLimit: "yes",
  deletingKeyStopsCharges: "yes",
  stoppingRequestsStopsCharges: "yes",
  activeSubscriptions: "no",
  safestZeroSpend: "Không thêm thẻ.",
  cardRequired: "no",
  fixedFreeQuota: "yes",
  automaticPaidUsage: "no",
  exhaustionBehaviour: "HARD_STOP",
  autoTopupDefaultOn: "no",
  postpaid: "no",
  thresholdCollection: "no",
  paidNeedsManualAction: "yes",
  authHoldUnverifiable: "no",
  termsUnclear: "no",
});

function offer(partial: Partial<ProviderOffer> & Pick<ProviderOffer, "id" | "status">): ProviderOffer {
  return {
    providerId: "p",
    kind: "monthly_free",
    amount: { value: "UNKNOWN", source: "public_docs" },
    unit: "requests",
    rpm: { value: "UNKNOWN", source: "public_docs" },
    tpm: { value: "UNKNOWN", source: "public_docs" },
    rpd: { value: "UNKNOWN", source: "public_docs" },
    context: { value: "UNKNOWN", source: "public_docs" },
    models: [],
    expiresAt: null,
    requirements: [],
    appliesTo: "api_inference",
    ...partial,
  };
}

function model(id: string, patch: Partial<ScorecardModel> = {}): ScorecardModel {
  return {
    providerId: "p",
    modelId: id,
    autoConfigAllowed: true,
    paid: false,
    cooldown: false,
    context: 32000,
    capabilities: {
      json: { state: "documented", value: true },
      tools: { state: "tested", value: true },
      vision: { state: "tested", value: true },
      embedding: { state: "documented", value: true },
    },
    quotaLeft: 0.5,
    successRate: 0.9,
    schemaRate: 0.8,
    latencyMs: 400,
    costUsd: 0,
    quality: { appEval: 70, appEvalN: 12, realRun: 80, benchmarks: 60, documented: 50 },
    ...patch,
  };
}

describe("provider intel schemas and safety rules", () => {
  it("accepts stubs and requires a url plus a date on known facts", () => {
    for (const stub of PROVIDER_STUBS) expect(ProviderStubSchema.parse(stub).needsResearch).toBe(true);
    expect(PROVIDER_STUBS.filter((item) => item.discoveredFrom === "seed-extra").length).toBeGreaterThanOrEqual(8);
    const record = blankProvider(PROVIDER_STUBS[0]!);
    record.vietnam.signupAllowed = knownEvidence(true, "https://www.anthropic.com/signup", "2026-11-05T00:00:00.000Z", "public_docs", "Personal accounts may sign up.");
    expect(missingEvidence(record)).toEqual([]);
    record.vietnam.personalAccountOk = { value: true, source: "public_docs" };
    expect(missingEvidence(record).some((item) => item.includes("personalAccountOk"))).toBe(true);
  });

  it("scores unknown factors as zero and blocks auto-config", () => {
    const full = scoreProvider({
      legitimacy: "A",
      securityPrivacy: 100,
      tosCommercial: 100,
      freeValue: 100,
      vietnam: 100,
      apiCompatibility: 100,
      reliability: 100,
    });
    expect(full.score).toBe(100);
    const missing = scoreProvider({ ...{
      legitimacy: "A" as const,
      securityPrivacy: "UNKNOWN" as const,
      tosCommercial: 100,
      freeValue: 100,
      vietnam: 100,
      apiCompatibility: 100,
      reliability: 100,
    } });
    expect(missing.score).toBe(80);
    expect(missing.unknownFactors).toContain("securityPrivacy");
    expect(autoConfigAllowed({ legitimacy: "D", flags: [], billingRisk: "LOW" })).toBe(false);
    expect(autoConfigAllowed({ legitimacy: "A", flags: ["SECURITY_INCIDENT"], billingRisk: "LOW" })).toBe(false);
    expect(autoConfigAllowed({ legitimacy: "A", flags: ["BILLING_UNVERIFIED"], billingRisk: "LOW" })).toBe(false);
    expect(autoConfigAllowed({ legitimacy: "A", flags: [], billingRisk: "CRITICAL" })).toBe(false);
    expect(autoConfigAllowed({ legitimacy: "A", flags: [], billingRisk: "LOW" })).toBe(true);
  });

  it("classifies billing risk and never treats unknown exhaustion as a hard stop", () => {
    expect(billingAssessment(lowFacts()).riskLevel).toBe("LOW");
    expect(billingAssessment({ ...lowFacts(), cardRequired: "yes", paidNeedsManualAction: "yes" }).riskLevel).toBe("MEDIUM");
    expect(billingAssessment({ ...lowFacts(), autoTopupDefaultOn: "yes", cardRequired: "yes" }).riskLevel).toBe("HIGH");
    expect(billingAssessment({ ...lowFacts(), postpaid: "yes" }).riskLevel).toBe("HIGH");
    expect(billingAssessment({ ...lowFacts(), paidContinuesAfterFree: "yes", automaticPaidUsage: "yes" }).riskLevel).toBe("HIGH");
    expect(billingAssessment({ ...lowFacts(), hardSpendingLimit: "no" }).riskLevel).toBe("HIGH");
    expect(billingAssessment({ ...lowFacts(), canChargeAutomatically: "yes", canDisableAutoCharge: "no" }).riskLevel).toBe("CRITICAL");
    expect(billingAssessment({ ...lowFacts(), authHoldUnverifiable: "yes" }).riskLevel).toBe("CRITICAL");
    const unknown = billingAssessment({ ...lowFacts(), safestZeroSpend: "UNKNOWN", exhaustionBehaviour: "UNKNOWN" });
    expect(unknown.unverified).toBe(true);
    expect(unknown.exhaustionIsHardStop).toBe(false);
    expect(unknown.riskLevel).not.toBe("LOW");
    expect(exhaustionIsHardStop("UNKNOWN")).toBe(false);
    expect(exhaustionIsHardStop("HARD_STOP")).toBe(true);
  });

  it("keeps a verbatim quote and drops a changed one", () => {
    const page = "Free tier includes 1 million tokens per month.";
    const kept = acceptExtractedFields(page, [
      { path: "a", value: "1", quote: "Free tier includes 1 million tokens" },
      { path: "b", value: "2", quote: "Free tier includes 9 million tokens" },
    ]);
    expect(kept.accepted.map((item) => item.path)).toEqual(["a"]);
    expect(kept.rejected.map((item) => item.path)).toEqual(["b"]);
    expect(quoteInPage(page, "Free   tier includes 1 million tokens")).toBe(true);
  });

  it("moves expired offers and ignores chatbot-only api value", () => {
    const now = new Date("2026-11-05T00:00:00.000Z");
    const split = partitionOffers([
      offer({ id: "live", status: "active", expiresAt: "2026-11-20T00:00:00.000Z" }),
      offer({ id: "soon", status: "active", expiresAt: "2026-11-08T00:00:00.000Z" }),
      offer({ id: "old", status: "active", expiresAt: "2026-11-01T00:00:00.000Z" }),
    ], now);
    expect(split.active.map((item) => item.id)).toEqual(["live", "soon"]);
    expect(split.expired.map((item) => item.id)).toEqual(["old"]);
    expect(split.moved).toHaveLength(1);
    expect(split.expiring.map((item) => item.id)).toEqual(["soon"]);
    expect(offerCountsAsApi(offer({ id: "chat", status: "active", kind: "chatbot_only_not_api", appliesTo: "chat_ui" }))).toBe(false);
  });

  it("allows only the provider site and honours robots plus probe limits", () => {
    expect(hostAllowed("https://www.scaleway.com", "https://www.scaleway.com/en/pricing")).toBe(true);
    expect(hostAllowed("https://www.scaleway.com", "https://docs.scaleway.com/api")).toBe(true);
    expect(hostAllowed("https://www.scaleway.com", "https://evil.com/pricing")).toBe(false);
    const robots = "User-agent: *\nDisallow: /secret\n\nUser-agent: otherbot\nDisallow: /pricing\n";
    expect(robotsDisallows(robots, "/secret/page")).toBe(true);
    expect(robotsDisallows(robots, "/pricing")).toBe(false);
    expect(connectionProbeAllowed({ authType: "api_key" })).toBe(true);
    expect(connectionProbeAllowed({ authType: "cookie" })).toBe(false);
    expect(connectionProbeAllowed({ type: "unknown" })).toBe(false);
    expect(connectionProbeAllowed({})).toBe(false);
    expect(probeAllowedToday("2026-11-05T01:00:00.000Z", new Date("2026-11-05T10:00:00.000Z"))).toBe(false);
    expect(probeAllowedToday("2026-11-04T01:00:00.000Z", new Date("2026-11-05T10:00:00.000Z"))).toBe(true);
    expect(connectionStates({
      configured: true,
      credentialPresent: true,
      testOk: true,
      modelsDiscovered: true,
      probeOk: false,
      rateLimited: false,
      quotaExhausted: false,
      expired: false,
      invalidCredentials: false,
    })).toEqual(["CONFIGURED", "AUTHENTICATED", "CONNECTED", "MODEL_DISCOVERED"]);
  });

  it("answers the ten overview questions", () => {
    expect(overviewQuestions({
      registered: 2, callable: 1, freeQuota: 1, unusedBenefits: 0, cloudExtras: 3,
      vietnamOk: 0, cardOrKyc: 1, expiringSoon: 0, usefulForProjects: 1, safeToActivate: 0,
    })).toHaveLength(10);
  });
});

describe("routing and scorecard", () => {
  it("covers every model task and does not mix benchmark versions", () => {
    expect(everyTaskHasAbilities()).toBe(true);
    for (const task of LLM_TASKS) expect(task.id in { ...Object.fromEntries(LLM_TASKS.map((item) => [item.id, true])) }).toBe(true);
    expect(benchmarkApplies("script", "swe-bench")).toBe(false);
    expect(benchmarkApplies("assistantChat", "swe-bench")).toBe(true);
    const now = new Date("2026-11-05T00:00:00.000Z");
    const base = {
      id: "b",
      modelId: "m",
      metric: "score",
      sourceUrl: "https://www.swebench.com",
      quote: "score 10",
      source: "leaderboard" as const,
    };
    const mixed = benchmarkComponent([
      { ...base, benchmark: "swe-bench", version: "1", value: 0, measuredAt: "2026-01-01T00:00:00.000Z" },
      { ...base, id: "b2", benchmark: "swe-bench", version: "2", value: 90, measuredAt: "2026-10-01T00:00:00.000Z" },
    ], "assistantChat", now);
    expect(mixed?.score).toBe(90);
    const fresh = "2026-10-01T00:00:00.000Z";
    const stale = new Date(now.getTime() - (BENCHMARK_STALE_DAYS + 5) * 86_400_000).toISOString();
    const weighted = benchmarkComponent([
      { ...base, benchmark: "swe-bench", version: "2", value: 100, measuredAt: fresh },
      { ...base, id: "b3", benchmark: "aider", version: "1", value: 0, measuredAt: stale },
    ], "assistantChat", now);
    expect(weighted?.score).toBeCloseTo(100 / 1.5);
    expect(weighted?.stale).toBe(true);
  });

  it("drops missing quality sources instead of inventing them and orders ECO apart from QUALITY", () => {
    const partial = model("partial", { quality: { appEval: null, realRun: 80, benchmarks: 40, documented: 60 } });
    const card = modelScorecard({ taskId: "metadata", budgetMode: "QUALITY", paidFallback: false, models: [partial] });
    expect(card.ranked[0]?.confidence).not.toBe("high");
    const eco = modelScorecard({
      taskId: "metadata",
      budgetMode: "ECO",
      paidFallback: false,
      models: [
        model("quota", { quality: { appEval: 40, appEvalN: 10, realRun: 80, benchmarks: 50, documented: 50 }, quotaLeft: 0.9 }),
        model("star", { quality: { appEval: 95, appEvalN: 10, realRun: 80, benchmarks: 50, documented: 50 }, quotaLeft: 0.2 }),
      ],
    });
    const quality = modelScorecard({
      taskId: "metadata",
      budgetMode: "QUALITY",
      paidFallback: false,
      models: [
        model("quota", { quality: { appEval: 40, appEvalN: 10, realRun: 80, benchmarks: 50, documented: 50 }, quotaLeft: 0.9 }),
        model("star", { quality: { appEval: 95, appEvalN: 10, realRun: 80, benchmarks: 50, documented: 50 }, quotaLeft: 0.2 }),
      ],
    });
    expect(eco.ranked[0]?.modelId).toBe("quota");
    expect(quality.ranked[0]?.modelId).toBe("star");
    const filtered = modelScorecard({
      taskId: "metadata",
      budgetMode: "BALANCED",
      paidFallback: false,
      models: [
        model("paid", { paid: true }),
        model("cool", { cooldown: true }),
        model("unknown-quota", { quotaLeft: "UNKNOWN" }),
        model("blind", { capabilities: { json: { state: "UNKNOWN", value: true } } }),
      ],
    });
    expect(filtered.ranked).toEqual([]);
    expect(filtered.excluded.map((item) => item.modelId).sort()).toEqual(["blind", "cool", "paid", "unknown-quota"]);
  });

  it("withholds paid models and unknown quota from a profile chain", () => {
    const profile = ROUTING_PROFILES.find((item) => item.id === "agent")!;
    const cap = {
      tools: { state: "tested" as const, value: true },
      json: { state: "documented" as const, value: true },
    };
    const result = recommendProfile(profile, [
      { providerId: "p", modelId: "free", autoConfigAllowed: true, paid: false, cooldown: false, context: 32000, capabilities: cap, quotaLeft: 0.4, reliability: 80, quality: 70, latencyMs: 300, cost: 0 },
      { providerId: "p", modelId: "paid", autoConfigAllowed: true, paid: true, cooldown: false, context: 32000, capabilities: cap, quotaLeft: 0.9, reliability: 90, quality: 90, latencyMs: 200, cost: 1 },
      { providerId: "p", modelId: "mystery", autoConfigAllowed: true, paid: false, cooldown: false, context: 32000, capabilities: cap, quotaLeft: "UNKNOWN", reliability: 90, quality: 90, latencyMs: 200, cost: 0 },
      { providerId: "p", modelId: "named", autoConfigAllowed: true, paid: false, cooldown: false, context: 32000, capabilities: { tools: { state: "UNKNOWN", value: true }, json: cap.json }, quotaLeft: 1, reliability: 90, quality: 90, latencyMs: 200, cost: 0 },
    ], { paidFallback: false });
    expect(result.chain.map((item) => item.modelId)).toEqual(["free"]);
    expect(result.withheld.some((item) => item.modelId === "mystery")).toBe(true);
    expect(capabilityFromEvidence({ name: "vision-model" } as { state?: string })).toEqual({ state: "UNKNOWN", value: false });
  });
});
