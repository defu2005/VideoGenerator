import type { ProviderOffer, RiskFlag } from "../schemas/providerIntel.js";

export const SCORE_WEIGHTS = {
  legitimacy: 15,
  securityPrivacy: 20,
  tosCommercial: 15,
  freeValue: 20,
  vietnam: 10,
  apiCompatibility: 10,
  reliability: 10,
} as const;

export type ScoreInputs = {
  legitimacy: "A" | "B" | "C" | "D" | "UNKNOWN";
  securityPrivacy: number | "UNKNOWN";
  tosCommercial: number | "UNKNOWN";
  freeValue: number | "UNKNOWN";
  vietnam: number | "UNKNOWN";
  apiCompatibility: number | "UNKNOWN";
  reliability: number | "UNKNOWN";
};

export type ScoreResult = {
  score: number;
  unknownFactors: string[];
  factors: Record<keyof ScoreInputs, number>;
};

function letterScore(grade: ScoreInputs["legitimacy"]): { points: number; unknown: boolean } {
  if (grade === "UNKNOWN") return { points: 0, unknown: true };
  if (grade === "A") return { points: 100, unknown: false };
  if (grade === "B") return { points: 75, unknown: false };
  if (grade === "C") return { points: 40, unknown: false };
  return { points: 0, unknown: false };
}

function numberScore(value: number | "UNKNOWN"): { points: number; unknown: boolean } {
  if (value === "UNKNOWN") return { points: 0, unknown: true };
  return { points: Math.max(0, Math.min(100, value)), unknown: false };
}

/** UNKNOWN scores 0 for that factor. It is not dropped from the denominator. */
export function scoreProvider(input: ScoreInputs): ScoreResult {
  const factors = {} as ScoreResult["factors"];
  const unknownFactors: string[] = [];
  let total = 0;
  (Object.keys(SCORE_WEIGHTS) as Array<keyof ScoreInputs>).forEach((key) => {
    const scored = key === "legitimacy" ? letterScore(input.legitimacy) : numberScore(input[key] as number | "UNKNOWN");
    factors[key] = scored.points;
    if (scored.unknown) unknownFactors.push(key);
    total += scored.points * (SCORE_WEIGHTS[key] / 100);
  });
  return { score: Math.round(total * 10) / 10, unknownFactors, factors };
}

export type YesNo = "yes" | "no" | "UNKNOWN";

export type BillingFacts = {
  canChargeAutomatically: YesNo;
  chargeTrigger: string | "UNKNOWN";
  canDisableAutoCharge: YesNo | "not_applicable";
  paidContinuesAfterFree: YesNo;
  collectsOutstanding: YesNo;
  hardSpendingLimit: YesNo;
  deletingKeyStopsCharges: YesNo;
  stoppingRequestsStopsCharges: YesNo;
  activeSubscriptions: YesNo;
  safestZeroSpend: string | "UNKNOWN";
  cardRequired: YesNo;
  fixedFreeQuota: YesNo;
  automaticPaidUsage: YesNo;
  exhaustionBehaviour: "HARD_STOP" | "SOFT_STOP" | "AUTO_TOPUP" | "POSTPAID" | "SUBSCRIPTION_CONVERSION" | "UNKNOWN";
  autoTopupDefaultOn: YesNo;
  postpaid: YesNo;
  thresholdCollection: YesNo;
  paidNeedsManualAction: YesNo;
  authHoldUnverifiable: YesNo;
  termsUnclear: YesNo;
};

const TEN_KEYS = [
  "canChargeAutomatically",
  "chargeTrigger",
  "canDisableAutoCharge",
  "paidContinuesAfterFree",
  "collectsOutstanding",
  "hardSpendingLimit",
  "deletingKeyStopsCharges",
  "stoppingRequestsStopsCharges",
  "activeSubscriptions",
  "safestZeroSpend",
] as const;

/** UNKNOWN exhaustion is never a hard stop. */
export function exhaustionIsHardStop(value: string): boolean {
  return value === "HARD_STOP";
}

export function billingAssessment(facts: BillingFacts): {
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  unverified: boolean;
  exhaustionIsHardStop: boolean;
} {
  const unverified = TEN_KEYS.some((key) => facts[key] === "UNKNOWN");
  const hardStop = exhaustionIsHardStop(facts.exhaustionBehaviour);
  const critical = facts.termsUnclear === "yes"
    || facts.authHoldUnverifiable === "yes"
    || (facts.canChargeAutomatically === "yes" && facts.canDisableAutoCharge === "no")
    || facts.collectsOutstanding === "UNKNOWN"
    || facts.canChargeAutomatically === "UNKNOWN"
    || facts.authHoldUnverifiable === "UNKNOWN";
  if (critical) return { riskLevel: "CRITICAL", unverified, exhaustionIsHardStop: hardStop };

  const high = facts.autoTopupDefaultOn === "yes"
    || facts.postpaid === "yes"
    || facts.thresholdCollection === "yes"
    || facts.paidContinuesAfterFree === "yes"
    || facts.hardSpendingLimit === "no"
    || facts.automaticPaidUsage === "yes"
    || facts.exhaustionBehaviour === "AUTO_TOPUP"
    || facts.exhaustionBehaviour === "POSTPAID"
    || facts.exhaustionBehaviour === "SUBSCRIPTION_CONVERSION"
    || facts.exhaustionBehaviour === "UNKNOWN"
    || facts.hardSpendingLimit === "UNKNOWN";
  if (high) return { riskLevel: "HIGH", unverified, exhaustionIsHardStop: hardStop };

  const medium = facts.cardRequired === "yes"
    && facts.fixedFreeQuota === "yes"
    && facts.paidNeedsManualAction === "yes"
    && facts.autoTopupDefaultOn === "no"
    && facts.automaticPaidUsage === "no"
    && facts.paidContinuesAfterFree === "no";
  if (medium) return { riskLevel: "MEDIUM", unverified, exhaustionIsHardStop: hardStop };

  const low = facts.cardRequired === "no"
    && facts.fixedFreeQuota === "yes"
    && facts.automaticPaidUsage === "no"
    && hardStop
    && facts.paidContinuesAfterFree === "no"
    && facts.canChargeAutomatically === "no"
    && facts.autoTopupDefaultOn === "no";
  if (low) return { riskLevel: "LOW", unverified, exhaustionIsHardStop: true };
  return { riskLevel: "HIGH", unverified, exhaustionIsHardStop: hardStop };
}

export function autoConfigAllowed(input: {
  legitimacy: string;
  flags: string[];
  billingRisk: string;
}): boolean {
  if (input.legitimacy === "D") return false;
  if (input.flags.includes("SECURITY_INCIDENT")) return false;
  if (input.billingRisk === "CRITICAL") return false;
  if (input.flags.includes("BILLING_UNVERIFIED")) return false;
  return true;
}

type YnField = { value: unknown };

function yn(field: YnField | undefined): YesNo {
  if (field?.value === "yes" || field?.value === true) return "yes";
  if (field?.value === "no" || field?.value === false) return "no";
  return "UNKNOWN";
}

export function riskFlags(input: {
  legitimacy: string;
  legalEntityUnknown: boolean;
  commercialUseAllowed: YesNo;
  freeOutputCommercial: YesNo;
  conflicts: number;
  trainsOnPrompts: YesNo;
  optOut: YesNo;
  signupAllowed: YesNo;
  geoRestricted: boolean;
  suspendWithoutNotice: YesNo;
  unresolvedIncident: boolean;
  billingRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  unverified: boolean;
  offers: Array<Pick<ProviderOffer, "kind" | "appliesTo" | "status">>;
  hasApi: boolean;
}): RiskFlag[] {
  const flags = new Set<RiskFlag>();
  if (input.commercialUseAllowed === "no" || input.conflicts > 0) flags.add("LEGAL_RISK");
  if (input.trainsOnPrompts === "yes" && input.optOut !== "yes") flags.add("PRIVACY_RISK");
  if (input.billingRisk === "HIGH" || input.billingRisk === "CRITICAL") flags.add("BILLING_RISK");
  if (input.unverified) flags.add("BILLING_UNVERIFIED");
  if (input.signupAllowed === "no" || input.geoRestricted) flags.add("REGION_RESTRICTION");
  if (input.legalEntityUnknown || input.legitimacy === "UNKNOWN") flags.add("UNVERIFIED_COMPANY");
  const active = input.offers.filter((offer) => offer.status !== "expired");
  if (active.length > 0 && active.every((offer) => offer.kind === "promo_credit" || offer.kind === "referral_credit" || offer.kind === "chatbot_only_not_api")) {
    flags.add("PROMOTIONAL_ONLY");
  }
  if (active.some((offer) => offer.kind === "chatbot_only_not_api") && !active.some((offer) => offer.appliesTo === "api_inference")) {
    flags.add("NO_API_ACCESS");
  }
  if (!input.hasApi && active.length === 0 && input.legitimacy !== "UNKNOWN") flags.add("NO_API_ACCESS");
  if (input.commercialUseAllowed === "no" || input.freeOutputCommercial === "no") flags.add("NONCOMMERCIAL_ONLY");
  if (input.unresolvedIncident) flags.add("SECURITY_INCIDENT");
  if (input.suspendWithoutNotice === "yes") flags.add("ACCOUNT_SUSPENSION_RISK");
  return [...flags];
}

export { yn };
