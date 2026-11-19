import { z } from "zod";
import type { JobUsage } from "@vg/shared";
import type { TrustedAgent } from "../supervision/identity.js";

export const AgentUsageSchema = z.object({ calls: z.array(z.object({
  model: z.string().trim().min(1).max(200), inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(), costUsd: z.number().nonnegative().finite().optional(),
}).strict()).min(1).max(100) }).strict();
export type AgentUsage = z.infer<typeof AgentUsageSchema>;
export function stageAgentUsage(agent: TrustedAgent, reported?: AgentUsage): JobUsage {
  const items: AgentUsage["calls"] = reported ? AgentUsageSchema.parse(reported).calls : [{ model: agent.model ?? "unknown" }];
  const calls: NonNullable<JobUsage["calls"]> = items.map((call) => ({ task: "agentStage", provider: `agent:${agent.instance}`, model: call.model,
    ...(reported ? {} : { callCount: 0 }),
    inputTokens: call.inputTokens ?? 0, outputTokens: call.outputTokens ?? 0, cached: false, fallback: false, ok: true,
    ...(call.costUsd === undefined ? { costUnknown: true } : { costUsd: call.costUsd }) }));
  return { llmCalls: reported ? calls.length : 0, inputTokens: calls.reduce((n, c) => n + c.inputTokens, 0), outputTokens: calls.reduce((n, c) => n + c.outputTokens, 0),
    costUsd: calls.reduce((n, c) => n + (c.costUsd ?? 0), 0), calls,
    ...(calls.some((call) => call.costUnknown) ? { costUnknown: true } : {}),
    ...(items.some((call) => call.inputTokens === undefined || call.outputTokens === undefined) ? { tokensUnknown: true } : {}) };
}
