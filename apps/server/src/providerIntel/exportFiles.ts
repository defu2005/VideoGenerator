import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redactExportText } from "@vg/shared";

export const EXPORT_README = `# Hồ sơ nhà cung cấp

Thư mục này do ứng dụng ghi ra sau mỗi lần chạy việc nhà cung cấp.

Cơ sở dữ liệu của ứng dụng là nguồn đúng. File ở đây là bản xuất để đọc.
\`monitoring/\` và \`reports/\` thay đổi thường xuyên và không được git theo dõi.
Phần nghiên cứu và đánh giá thì được giữ trong git khi bạn commit.

Không có khoá, token, cookie hay email đầy đủ trong các file này.
`;

export function writeReportFile(root: string, relative: string, contents: string): void {
  write(root, relative, contents);
}

function write(root: string, relative: string, contents: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, redactExportText(contents), "utf8");
}

function json(root: string, relative: string, value: unknown): void {
  write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeIntelExport(root: string, view: Record<string, unknown>, reportVi: string): string[] {
  const files = [
    "providers/provider_catalog.json",
    "providers/model_catalog.json",
    "offers/active_offers.json",
    "offers/expired_offers.json",
    "security/security_assessments.json",
    "security/incident_history.json",
    "legal/tos_assessments.json",
    "legal/privacy_assessments.json",
    "monitoring/provider_status.json",
    "monitoring/quota_status.json",
    "monitoring/health_checks.json",
    "config/routing_profiles.json",
    "config/provider_policy.json",
    "billing/billing_risk_report.json",
    "billing/auto_charge_status.json",
    "billing/payment_authorization_report.json",
    "billing/free_quota_exhaustion_behavior.json",
    "billing/active_subscriptions.json",
    "billing/active_paid_resources.json",
    "billing/spending_control_capabilities.json",
    "billing/unexpected_charge_warnings.json",
    "accounts/existing_omniroute_providers.json",
    "accounts/provider_account_benefits.json",
    "accounts/cloud_ecosystem_benefits.json",
    "accounts/unused_account_benefits.json",
    "accounts/expiring_credits.json",
    "accounts/provider_audit_history.json",
  ];
  const payload: Record<string, unknown> = {
    "providers/provider_catalog.json": view.providers,
    "providers/model_catalog.json": view.models,
    "offers/active_offers.json": view.activeOffers,
    "offers/expired_offers.json": view.expiredOffers,
    "security/security_assessments.json": view.security,
    "security/incident_history.json": view.incidents,
    "legal/tos_assessments.json": view.tos,
    "legal/privacy_assessments.json": view.privacy,
    "monitoring/provider_status.json": view.providerStatus,
    "monitoring/quota_status.json": view.quotaStatus,
    "monitoring/health_checks.json": view.health,
    "config/routing_profiles.json": view.routingProfiles,
    "config/provider_policy.json": view.policy,
    "billing/billing_risk_report.json": view.billing,
    "billing/auto_charge_status.json": view.autoCharge,
    "billing/payment_authorization_report.json": view.paymentAuth,
    "billing/free_quota_exhaustion_behavior.json": view.exhaustion,
    "billing/active_subscriptions.json": view.subscriptions,
    "billing/active_paid_resources.json": view.paidResources,
    "billing/spending_control_capabilities.json": view.spendingControls,
    "billing/unexpected_charge_warnings.json": view.chargeWarnings,
    "accounts/existing_omniroute_providers.json": view.connections,
    "accounts/provider_account_benefits.json": view.accountBenefits,
    "accounts/cloud_ecosystem_benefits.json": view.cloudBenefits,
    "accounts/unused_account_benefits.json": view.unusedBenefits,
    "accounts/expiring_credits.json": view.expiring,
    "accounts/provider_audit_history.json": view.auditHistory,
  };
  for (const file of files) json(root, file, payload[file] ?? []);
  const providers = Array.isArray(view.providerIds) ? view.providerIds as string[] : [];
  for (const id of providers) json(root, `providers/provider_details/${id}.json`, view.details && typeof view.details === "object" ? (view.details as Record<string, unknown>)[id] : {});
  write(root, "accounts/activation_instructions.md", String(view.activationMarkdown ?? ""));
  write(root, "README.md", EXPORT_README);
  const day = String(view.day ?? "ngay");
  write(root, `reports/daily/${day}.md`, reportVi);
  write(root, `reports/weekly/${day}.md`, reportVi);
  return [...files, "accounts/activation_instructions.md", "README.md", `reports/daily/${day}.md`, `reports/weekly/${day}.md`];
}
