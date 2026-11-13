import { randomUUID } from "node:crypto";
import { AGENT_EVENT_TYPES, type AgentEvent, type AgentEventType } from "@vg/shared";

const buffer: AgentEvent[] = [];
const listeners = new Set<(event: AgentEvent) => void>();
const MAX = 500;

export function publishAgentEvent(input: Omit<AgentEvent, "id" | "version" | "at" | "link"> & { link?: string }): AgentEvent {
  const event: AgentEvent = {
    ...input,
    id: randomUUID(),
    version: 1,
    at: new Date().toISOString(),
    link: input.link ?? (input.projectId ? `/projects/${input.projectId}/overview` : "/"),
  };
  buffer.push(event);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  for (const listener of listeners) listener(event);
  return event;
}

export function subscribeAgentEvents(listener: (event: AgentEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listAgentEvents(filter: { since?: string; types?: string[]; projectId?: string; limit?: number } = {}): AgentEvent[] {
  const types = new Set((filter.types ?? []).filter((item): item is AgentEventType => (AGENT_EVENT_TYPES as readonly string[]).includes(item)));
  const after = filter.since ? buffer.findIndex((item) => item.id === filter.since) : -1;
  const slice = after >= 0 ? buffer.slice(after + 1) : buffer;
  return slice.filter((item) => {
    if (filter.projectId && item.projectId !== filter.projectId) return false;
    if (types.size && !types.has(item.type)) return false;
    return true;
  }).slice(-(filter.limit ?? 100));
}

export function resetAgentEvents(): void {
  buffer.splice(0, buffer.length);
  listeners.clear();
}
