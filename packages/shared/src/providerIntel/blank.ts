import {
  BillingSchema,
  ProviderRecordSchema,
  type ProviderBilling,
  type ProviderRecord,
  type ProviderStub,
} from "../schemas/providerIntel.js";
import { billingAssessment, riskFlags, scoreProvider, type BillingFacts } from "./assess.js";
import { unknownEvidence } from "./evidence.js";

const yes = unknownEvidence<"yes" | "no">();
const text = unknownEvidence<string>();
const bool = unknownEvidence<boolean>();
const num = unknownEvidence<number>();

export function blankBilling(): ProviderBilling {
  return BillingSchema.parse({
    mode: unknownEvidence(),
    cardRequired: yes,
    authHold: { exists: yes, amount: text, captured: yes },
    autoTopup: { defaultOn: yes, canDisable: yes, trigger: text, min: text, max: text },
    thresholdBilling: { exists: yes, defaultUsd: text, autoRaise: yes },
    recurringSubscription: yes,
    trialAutoConverts: yes,
    postpaidCollectsOutstanding: yes,
    exhaustionBehaviour: unknownEvidence(),
    spendingControls: {
      hardCap: bool,
      monthlyCap: bool,
      perProject: bool,
      perKey: bool,
      perModel: bool,
      alerts: bool,
      autoSuspend: bool,
      keyRevocation: bool,
      cardRemoval: bool,
    },
    revokingKeyStopsCharges: yes,
    stoppingRequestsStopsCharges: yes,
    safestZeroSpendConfigVi: text,
    answers: {
      canChargeAutomatically: yes,
      chargeTrigger: text,
      canDisableAutoCharge: unknownEvidence(),
      paidContinuesAfterFree: yes,
      collectsOutstanding: yes,
      hardSpendingLimit: yes,
      deletingKeyStopsCharges: yes,
      stoppingRequestsStopsCharges: yes,
      activeSubscriptions: yes,
      safestZeroSpend: text,
    },
    riskLevel: "HIGH",
    unverified: true,
  });
}

export function blankProvider(stub: ProviderStub): ProviderRecord {
  const record: ProviderRecord = {
    id: stub.id,
    name: stub.name,
    website: stub.website,
    categories: stub.categories,
    needsResearch: true,
    ...(stub.discoveredFrom ? { discoveredFrom: stub.discoveredFrom } : {}),
    legalEntity: text,
    country: text,
    parentCompany: text,
    legitimacy: { grade: "UNKNOWN", reason: "Chưa có nguồn." },
    api: { protocols: [], baseUrl: text, docsUrl: text },
    tos: {
      summaryVi: "Chưa đọc điều khoản.",
      commercialUseAllowed: bool,
      freeOutputCommercial: bool,
      agentsAllowed: bool,
      resaleAllowed: bool,
      multiAccountBanned: bool,
      freeQuotaRevocable: bool,
      creditsExpire: bool,
      nonProductionOnly: bool,
      suspendWithoutNotice: bool,
      geoRestrictions: text,
      kycRequired: bool,
      conflictsVi: [],
      reviewConfidence: "normal",
    },
    privacy: {
      trainsOnPrompts: bool,
      optOut: bool,
      zeroRetention: bool,
      retentionDays: num,
      dataResidency: text,
      certifications: [],
      subprocessorsUrl: text,
      incidents: [],
      reviewConfidence: "normal",
    },
    vietnam: {
      signupAllowed: bool,
      vnCardAccepted: bool,
      needsChinesePhoneOrId: bool,
      needsBusiness: bool,
      personalAccountOk: bool,
    },
    billing: blankBilling(),
    scoreInputs: {
      legitimacy: "UNKNOWN",
      securityPrivacy: "UNKNOWN",
      tosCommercial: "UNKNOWN",
      freeValue: "UNKNOWN",
      vietnam: "UNKNOWN",
      apiCompatibility: "UNKNOWN",
      reliability: "UNKNOWN",
    },
    score: 0,
    flags: [],
    autoConfigAllowed: false,
  };
  return recomputeProvider(record, []);
}

export function billingFactsOf(record: ProviderRecord): BillingFacts {
  const answers = record.billing.answers;
  const value = (field: { value: unknown }) => field.value;
  const yn = (field: { value: unknown }) => (field.value === "yes" || field.value === "no" ? field.value : "UNKNOWN");
  const exhaustion = record.billing.exhaustionBehaviour.value;
  return {
    canChargeAutomatically: yn(answers.canChargeAutomatically),
    chargeTrigger: typeof value(answers.chargeTrigger) === "string" ? String(value(answers.chargeTrigger)) : "UNKNOWN",
    canDisableAutoCharge: answers.canDisableAutoCharge.value === "yes" || answers.canDisableAutoCharge.value === "no" || answers.canDisableAutoCharge.value === "not_applicable"
      ? answers.canDisableAutoCharge.value
      : "UNKNOWN",
    paidContinuesAfterFree: yn(answers.paidContinuesAfterFree),
    collectsOutstanding: yn(answers.collectsOutstanding),
    hardSpendingLimit: yn(answers.hardSpendingLimit),
    deletingKeyStopsCharges: yn(answers.deletingKeyStopsCharges),
    stoppingRequestsStopsCharges: yn(answers.stoppingRequestsStopsCharges),
    activeSubscriptions: yn(answers.activeSubscriptions),
    safestZeroSpend: typeof value(answers.safestZeroSpend) === "string" ? String(value(answers.safestZeroSpend)) : "UNKNOWN",
    cardRequired: yn(record.billing.cardRequired),
    fixedFreeQuota: "UNKNOWN",
    automaticPaidUsage: yn(answers.paidContinuesAfterFree) === "yes" ? "yes" : yn(answers.paidContinuesAfterFree) === "no" ? "no" : "UNKNOWN",
    exhaustionBehaviour: exhaustion === "HARD_STOP" || exhaustion === "SOFT_STOP" || exhaustion === "AUTO_TOPUP" || exhaustion === "POSTPAID" || exhaustion === "SUBSCRIPTION_CONVERSION"
      ? exhaustion
      : "UNKNOWN",
    autoTopupDefaultOn: yn(record.billing.autoTopup.defaultOn),
    postpaid: record.billing.mode.value === "postpaid" ? "yes" : record.billing.mode.value === "UNKNOWN" ? "UNKNOWN" : "no",
    thresholdCollection: yn(record.billing.thresholdBilling.exists),
    paidNeedsManualAction: yn(answers.paidContinuesAfterFree) === "no" ? "yes" : yn(answers.paidContinuesAfterFree) === "yes" ? "no" : "UNKNOWN",
    authHoldUnverifiable: record.billing.authHold.exists.value === "UNKNOWN"
      || (record.billing.authHold.exists.value === "yes" && (record.billing.authHold.amount.value === "UNKNOWN" || record.billing.authHold.captured.value === "UNKNOWN"))
      ? "yes"
      : "no",
    termsUnclear: "no",
  };
}

export function recomputeProvider(record: ProviderRecord, offers: Array<{ kind: ProviderRecord extends never ? never : import("../schemas/providerIntel.js").ProviderOffer["kind"]; appliesTo: "api_inference" | "cloud_other" | "chat_ui"; status: "active" | "expired" | "unverified" }>): ProviderRecord {
  const facts = billingFactsOf(record);
  if (offers.some((offer) => offer.status === "active" && (offer.kind === "permanent_free" || offer.kind === "monthly_free" || offer.kind === "daily_free"))) {
    facts.fixedFreeQuota = "yes";
  }
  const billing = billingAssessment(facts);
  const flags = riskFlags({
    legitimacy: record.legitimacy.grade,
    legalEntityUnknown: record.legalEntity.value === "UNKNOWN",
    commercialUseAllowed: record.tos.commercialUseAllowed.value === true ? "yes" : record.tos.commercialUseAllowed.value === false ? "no" : "UNKNOWN",
    freeOutputCommercial: record.tos.freeOutputCommercial.value === true ? "yes" : record.tos.freeOutputCommercial.value === false ? "no" : "UNKNOWN",
    conflicts: record.tos.conflictsVi.length,
    trainsOnPrompts: record.privacy.trainsOnPrompts.value === true ? "yes" : record.privacy.trainsOnPrompts.value === false ? "no" : "UNKNOWN",
    optOut: record.privacy.optOut.value === true ? "yes" : record.privacy.optOut.value === false ? "no" : "UNKNOWN",
    signupAllowed: record.vietnam.signupAllowed.value === true ? "yes" : record.vietnam.signupAllowed.value === false ? "no" : "UNKNOWN",
    geoRestricted: typeof record.tos.geoRestrictions.value === "string" && record.tos.geoRestrictions.value !== "UNKNOWN" && record.tos.geoRestrictions.value !== "none",
    suspendWithoutNotice: record.tos.suspendWithoutNotice.value === true ? "yes" : record.tos.suspendWithoutNotice.value === false ? "no" : "UNKNOWN",
    unresolvedIncident: record.privacy.incidents.some((incident) => !incident.resolved),
    billingRisk: billing.riskLevel,
    unverified: billing.unverified,
    offers,
    hasApi: record.api.protocols.length > 0 && record.api.baseUrl.value !== "UNKNOWN",
  });
  const scored = scoreProvider(record.scoreInputs);
  const next: ProviderRecord = {
    ...record,
    billing: { ...record.billing, riskLevel: billing.riskLevel, unverified: billing.unverified },
    score: scored.score,
    flags,
    autoConfigAllowed: false,
  };
  next.autoConfigAllowed = next.legitimacy.grade !== "D"
    && !next.flags.includes("SECURITY_INCIDENT")
    && next.billing.riskLevel !== "CRITICAL"
    && !next.flags.includes("BILLING_UNVERIFIED");
  return ProviderRecordSchema.parse(next);
}
