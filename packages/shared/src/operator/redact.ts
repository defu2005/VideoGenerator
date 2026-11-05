import { maskEmailsInText } from "../llmQuota/live.js";

/**
 * Redaction used for operator text that is stored or shown.
 * Covers the TASK-045 email mask plus common secret shapes.
 * TASK-046 will extend this helper; callers should keep using this function.
 */
export function redactOperatorText(text: string): string {
  let out = maskEmailsInText(text);
  out = out.replace(/\bsk-[A-Za-z0-9]{8,}\b/g, "[redacted]");
  out = out.replace(/\boma_[A-Za-z0-9]+\b/g, "[redacted]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
  out = out.replace(/bot\d+:[A-Za-z0-9_-]+/g, "[redacted]");
  out = out.replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*\S+/gi, "$1=[redacted]");
  return out;
}
