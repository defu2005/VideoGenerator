const KINDS = new Set(["operator", "assistant", "hermes", "codex", "cursor", "claude", "other"]);
const LABEL = /^[A-Za-z0-9 ._-]{1,64}$/;

export type AgentIdentity = {
  kind: string;
  name: string;
  model: string | null;
  environment: string;
};

/**
 * Without `trusted` the kind still comes from the header (reports only). With `trusted` (TASK-122) the kind comes from
 * the machine key; a header that claims a different kind is ignored and reported through `onMismatch`.
 */
export function parseAgentIdentity(
  headers: Record<string, string | undefined>,
  trusted?: { kind: string; onMismatch?: (claimed: string) => void },
): AgentIdentity {
  const kindHeader = headers["x-vg-agent-kind"]?.trim();
  const claimed = kindHeader && KINDS.has(kindHeader) ? kindHeader : null;
  let kind = claimed ?? "other";
  if (trusted) {
    kind = trusted.kind;
    if (claimed && claimed !== trusted.kind) trusted.onMismatch?.(claimed);
  }
  return {
    kind,
    name: cleanLabel(headers["x-vg-agent-name"]) ?? "unknown",
    model: cleanLabel(headers["x-vg-agent-model"]),
    environment: cleanLabel(headers["x-vg-environment"]) ?? "unknown",
  };
}

function cleanLabel(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return LABEL.test(text) ? text : null;
}
