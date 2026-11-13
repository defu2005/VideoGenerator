import {
  containsProtectedProject,
  PROTECTED_PROJECT_ID,
  AutonomyGrantsSchema,
  TOOL_GRANTS,
  type AutonomySettings,
  type PipelineStage,
  type AssistantToolRisk,
} from "@vg/shared";

export type ToolSource = "assistant" | "mcp" | "operator" | "agent";

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
    if (/^(autonomy|grants|roles?|members?(\.manage)?|memberships?|channelIds|budget.*|repair|killed|ownerChatId|audit.*|agentKind|canSupervise)$/i.test(key)) {
      return "Công cụ không được đổi quyền tự vận hành, ngân sách hoặc nhật ký.";
    }
    if (/^(api[_-]?key|token|password|secret|credentials|paymentMethod|cardNumber)$/i.test(key) && child) {
      return "Công cụ không được đổi thông tin đăng nhập hoặc thanh toán.";
    }
    if (key === "allowCopyrightedStills") {
      return "Chỉ người dùng được đổi cho phép ảnh có bản quyền.";
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

export function autonomyDecision(name: string, args: unknown, settings: AutonomySettings): "run" | "pending" | "block" {
  if (hardBlockMessage(name, args)) return "block";
  if (settings.level === "off" || settings.level === "assist") return "pending";
  const grant = TOOL_GRANTS[name];
  if (!grant) return "pending";
  const { grants } = settings;
  const input = args as { gate?: PipelineStage; visibility?: string; body?: { visibility?: string } } | null;
  let allowed: boolean;
  switch (grant) {
    case "approveGates": allowed = Boolean(input?.gate && grants.approveGates.includes(input.gate)); break;
    case "publish": {
      const values = AutonomyGrantsSchema.shape.publish.options;
      const visibility = AutonomyGrantsSchema.shape.publish.safeParse(input?.body?.visibility ?? input?.visibility ?? "public");
      allowed = visibility.success && visibility.data !== "never"
        && values.indexOf(grants.publish) >= values.indexOf(visibility.data);
      break;
    }
    case "comments": allowed = grants.comments === "reply_and_hide" || (grants.comments === "reply" && name === "reply_comment"); break;
    case "omniroute": allowed = grants.omniroute === "write"; break;
    default: allowed = grants[grant]; break;
  }
  return allowed ? "run" : "pending";
}

export function hardBlockMessage(name: string, args: unknown): string | null {
  if (APPROVE_PENDING_TOOLS.has(name)) {
    return "Không có công cụ nào được duyệt thao tác chờ. Chỉ người dùng duyệt được.";
  }
  if (name !== "research_scene_visuals" && name !== "dedupe_scene_visuals" && name !== "crop_scene_images" && (name.includes(PROTECTED_PROJECT_ID) || containsProtectedProject(args))) {
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

export function forcesUserPending(name: string, args: unknown): boolean {
  return name === "delete_project" || enablesAutomation(name, args);
}

export function shouldCreatePending(input: {
  name: string;
  args: unknown;
  risk: string | undefined | null;
  source: ToolSource;
  autoConfirm: boolean;
  alwaysConfirm: boolean;
  autonomy?: AutonomySettings;
}): boolean {
  if (forcesUserPending(input.name, input.args)) return true;
  if (input.name === "computer_act" && !(input.autonomy && autonomyDecision(input.name, input.args, input.autonomy) === "run")) {
    return true;
  }
  if (input.autonomy) {
    const decision = autonomyDecision(input.name, input.args, input.autonomy);
    if (decision === "run") return false;
    if (decision === "pending" || decision === "block") return true;
  }
  const risk = effectiveRisk(input.risk);
  if (risk === "confirm" && !Object.hasOwn(TOOL_GRANTS, input.name)) return true;
  if (input.source === "agent") return false;
  if (risk !== "confirm") return false;
  if (input.source === "mcp" || input.source === "operator") return true;
  if (input.alwaysConfirm) return true;
  return !input.autoConfirm;
}
