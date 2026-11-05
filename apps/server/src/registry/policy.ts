import {
  containsProtectedProject,
  PROTECTED_PROJECT_ID,
  type AssistantToolRisk,
} from "@vg/shared";

export type ToolSource = "assistant" | "mcp" | "operator";

const APPROVE_PENDING_TOOLS = new Set([
  "approve_pending",
  "approve_pending_action",
  "confirm_pending",
  "confirm_pending_action",
  "confirm_action",
  "resolve_pending",
  "approve_action",
]);

export function effectiveRisk(risk: string | undefined | null): AssistantToolRisk {
  if (risk === "read" || risk === "safe" || risk === "confirm") return risk;
  return "confirm";
}

function walkForbidden(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkForbidden(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(api[_-]?key|token|password|secret|credentials|paymentMethod|cardNumber)$/i.test(key) && child) {
      return "Công cụ không được đổi thông tin đăng nhập hoặc thanh toán.";
    }
    if (key === "quotaPolicy" && child === "paid_fallback") {
      return "Công cụ không được bật fallback trả phí.";
    }
    if ((key === "paidFallbackDailyUsd" || /spendingLimit|maxSpend|raiseLimit/i.test(key)) && child != null) {
      return "Công cụ không được nâng hạn mức chi.";
    }
    const nested = walkForbidden(child);
    if (nested) return nested;
  }
  return null;
}

export function hardBlockMessage(name: string, args: unknown): string | null {
  if (APPROVE_PENDING_TOOLS.has(name)) {
    return "Không có công cụ nào được duyệt thao tác chờ. Chỉ người dùng duyệt được.";
  }
  if (name.includes(PROTECTED_PROJECT_ID) || containsProtectedProject(args)) {
    return "Dự án này bị từ chối.";
  }
  return walkForbidden(args);
}

export function enablesAutomation(name: string, args: unknown): boolean {
  if (name === "resume_automation_all") return true;
  if (name !== "set_profile_automation" || !args || typeof args !== "object") return false;
  const automation = (args as { automation?: { enabled?: boolean } }).automation;
  return automation?.enabled === true;
}

export function isPublicUpload(name: string, args: unknown): boolean {
  if (name !== "publish_project" || !args || typeof args !== "object") return false;
  const record = args as { body?: { visibility?: string }; visibility?: string };
  const visibility = record.body?.visibility ?? record.visibility;
  return visibility === undefined || visibility === "public";
}

export function forcesUserPending(name: string, args: unknown): boolean {
  return enablesAutomation(name, args) || isPublicUpload(name, args);
}

export function shouldCreatePending(input: {
  name: string;
  args: unknown;
  risk: string | undefined | null;
  source: ToolSource;
  autoConfirm: boolean;
  alwaysConfirm: boolean;
}): boolean {
  if (forcesUserPending(input.name, input.args)) return true;
  const risk = effectiveRisk(input.risk ?? undefined);
  if (risk !== "confirm") return false;
  if (input.source === "mcp" || input.source === "operator") return true;
  if (input.alwaysConfirm) return true;
  return !input.autoConfirm;
}
