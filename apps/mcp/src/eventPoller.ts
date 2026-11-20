/** Events the sidecar poller never wakes on: mailbox events reach an agent only through its own subscriptions, and the bus carries no recipient. */
export const POLLER_EXCLUDED_TYPES: readonly string[] = ["agent.message", "agent.question_escalated"];

export type PolledEvent = { id: string; type: string; summary: string };

export type PollDeps = {
  /** GET /api/events with the existing API key. `since` is the cursor from the previous poll. */
  fetchEvents: (since?: string) => Promise<{ events: PolledEvent[] }>;
  /** Called once per subscribed event; the real Hermes entry point is not wired yet (TASK-129a step 4 gap). */
  wake: (event: PolledEvent) => void;
  kinds: readonly string[];
};

export type PollResult = { cursor?: string; woke: number; primed: boolean };

/**
 * One poll cycle. The first cycle (no cursor) only primes the cursor and wakes nothing, so an old backlog never replays.
 * Logs and results carry counts only, never event summaries.
 */
export async function pollAgentEventsOnce(deps: PollDeps, cursor?: string): Promise<PollResult> {
  // "" means "primed, but nothing seen yet": it must not prime again on the next poll.
  const { events } = await deps.fetchEvents(cursor ? cursor : undefined);
  const last = events.at(-1)?.id;
  if (cursor === undefined) return { cursor: last ?? "", woke: 0, primed: true };
  const wanted = new Set(deps.kinds);
  let woke = 0;
  for (const event of events) {
    if (POLLER_EXCLUDED_TYPES.includes(event.type)) continue;
    if (!wanted.has(event.type)) continue;
    deps.wake(event);
    woke += 1;
  }
  return { cursor: last ?? cursor, woke, primed: false };
}

/** One mailbox peek row: ids and kinds only, never the body. */
export type InboxPeek = { id: string; kind: string; fromInstance: string; createdAt: string };
export type InboxPollDeps = {
  /** GET /api/agents/mailbox/peek with the machine key. Returns unacked mail addressed to this key's instance. */
  fetchPeek: () => Promise<{ messages: InboxPeek[] }>;
  wake: (message: InboxPeek) => void;
};
export type InboxPollResult = { seen: string[]; woke: number; primed: boolean };
const SEEN_CAP = 200;

/**
 * Wakes once per mail id. `seen` is the persisted set of ids already woken (undefined = first run).
 * The first run primes with the current ids and wakes nothing, so old unacked mail never replays.
 */
export async function pollInboxOnce(deps: InboxPollDeps, seen?: string[]): Promise<InboxPollResult> {
  const { messages } = await deps.fetchPeek();
  if (seen === undefined) return { seen: messages.map((m) => m.id).slice(-SEEN_CAP), woke: 0, primed: true };
  const known = new Set(seen);
  const fresh = messages.filter((m) => !known.has(m.id));
  for (const message of fresh) deps.wake(message);
  return { seen: [...seen, ...fresh.map((m) => m.id)].slice(-SEEN_CAP), woke: fresh.length, primed: false };
}
