import type { EventScope } from "./events.js";

export type AgentRunInput = {
  workspace: string;
  message: string;
  sessionId?: string | null;
  model?: string | null;
  history?: string;
  runId?: string;
  workflowId?: string;
  invocationToken?: string;
  eventScope?: EventScope;
  timeoutMs: number;
  shouldStop?: () => boolean;
  onDelta?: (text: string) => void;
  onTool?: (name: string) => void;
};

export type AgentRunResult = {
  sessionId: string | null;
  text: string;
  errorDetail: string;
  status: "completed" | "failed" | "timedOut" | "cancelled";
  writeViolations: string[];
  pendingIds?: string[];
  model?: string;
};

/**
 * Default policy for every adapter: tool calls go through invokeRegistryTool with
 * source "operator", so confirm-risk tools always become pending actions only the
 * user approves, and hard blocks (self-approval, credentials, payment, the
 * protected project, paid fallback) are refused and audited. A new adapter must
 * not call tools any other way.
 */
export type AgentRuntime = {
  id: string;
  version: string | null;
  capabilities: { mcp: boolean; resume: boolean; streaming: boolean; cancel: boolean };
  run(input: AgentRunInput): Promise<AgentRunResult>;
  resumeCommand?(sessionId?: string | null): string;
};
