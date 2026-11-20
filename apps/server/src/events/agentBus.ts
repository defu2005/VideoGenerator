import { randomUUID } from "node:crypto";
import { AGENT_EVENT_TYPES, type AgentEvent, type AgentEventType } from "@vg/shared";

type Entry = { event: AgentEvent; workspaceId?: string };

// workspaceId is kept server-side only (never on the wire). Non-mailbox events have none and stay unscoped (known gap, see GOAL-2026-11-18 decisions).
const buffer: Entry[] = [];
const listeners = new Set<(event: AgentEvent, workspaceId?: string) => void>();
const MAX = 500;

export function publishAgentEvent(
  input: Omit<AgentEvent, "id" | "version" | "at" | "link"> & { link?: string },
  options: { workspaceId?: string } = {},
): AgentEvent {
  const event: AgentEvent = {
    ...input,
    id: randomUUID(),
    version: 1,
    at: new Date().toISOString(),
    link: input.link ?? (input.projectId ? `/projects/${input.projectId}/overview` : "/"),
  };
  buffer.push({ event, workspaceId: options.workspaceId });
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  for (const listener of listeners) listener(event, options.workspaceId);
  return event;
}

export function subscribeAgentEvents(listener: (event: AgentEvent, workspaceId?: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listAgentEvents(filter: { since?: string; types?: string[]; projectId?: string; workspaceId?: string; limit?: number } = {}): AgentEvent[] {
  const types = new Set((filter.types ?? []).filter((item): item is AgentEventType => (AGENT_EVENT_TYPES as readonly string[]).includes(item)));
  const after = filter.since ? buffer.findIndex((item) => item.event.id === filter.since) : -1;
  const slice = after >= 0 ? buffer.slice(after + 1) : buffer;
  return slice.filter(({ event, workspaceId }) => {
    if (filter.workspaceId !== undefined && workspaceId !== undefined && workspaceId !== filter.workspaceId) return false;
    if (filter.projectId && event.projectId !== filter.projectId) return false;
    if (types.size && !types.has(event.type)) return false;
    return true;
  }).slice(-(filter.limit ?? 100)).map((entry) => entry.event);
}

export function resetAgentEvents(): void {
  buffer.splice(0, buffer.length);
  listeners.clear();
}
