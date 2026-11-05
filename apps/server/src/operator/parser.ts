export type StreamEvent =
  | { type: "init"; chatId: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "result"; text: string }
  | { type: "ignore" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const row = asRecord(item);
    if (!row) return "";
    return firstString(row.text, asRecord(row.delta)?.text) ?? "";
  }).join("");
}

function toolName(row: Record<string, unknown>): string | null {
  const direct = firstString(row.name, row.tool, row.toolName, row.tool_name);
  if (direct) return direct;
  const call = asRecord(row.tool_call) ?? asRecord(row.toolCall);
  if (!call) return null;
  const mcp = asRecord(call.mcpToolCall) ?? asRecord(call.mcp);
  if (mcp) return firstString(mcp.name, mcp.toolName, mcp.tool);
  return firstString(call.name, call.toolName, call.tool);
}

/** One stream-json line. Malformed lines are ignored. */
export function parseStreamLine(line: string): StreamEvent {
  const trimmed = line.trim();
  if (!trimmed) return { type: "ignore" };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { type: "ignore" };
  }
  const row = asRecord(value);
  if (!row) return { type: "ignore" };
  const type = typeof row.type === "string" ? row.type : "";
  const subtype = typeof row.subtype === "string" ? row.subtype : "";
  const chatId = firstString(row.session_id, row.sessionId, row.chatId, row.chat_id);

  if (type === "system" && subtype === "init") {
    return chatId ? { type: "init", chatId } : { type: "ignore" };
  }
  if (type === "result") {
    const text = firstString(row.result, row.text) ?? textFromContent(row.message) ?? textFromContent(asRecord(row.message)?.content);
    return { type: "result", text: text ?? "" };
  }
  if (type === "tool_call" || type === "tool_use") {
    if (subtype === "completed" || subtype === "finished") return { type: "ignore" };
    const name = toolName(row);
    return name ? { type: "tool", name } : { type: "ignore" };
  }
  if (type === "assistant" || type === "text" || type === "content_block_delta") {
    const message = asRecord(row.message);
    const delta = asRecord(row.delta);
    const text = textFromContent(message?.content)
      || textFromContent(row.content)
      || (firstString(delta?.text, row.text) ?? "");
    if (!text) return { type: "ignore" };
    return { type: "delta", text };
  }
  if (chatId && subtype === "init") return { type: "init", chatId };
  return { type: "ignore" };
}

/** Partial frames sometimes repeat the whole answer. Keep the longer snapshot. */
export function mergeStreamText(current: string, next: string): string {
  if (!next) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  return current + next;
}

export function looksLoggedOut(text: string): boolean {
  return /not logged in|not authenticated|please (log|sign) in|authentication required|login required|run .*(cursor-agent|agent) login/i.test(text);
}
