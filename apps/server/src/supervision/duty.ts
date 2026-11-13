import type Database from "better-sqlite3";
import { publishAgentEvent } from "../events/agentBus.js";
import type { TrustedAgent } from "./identity.js";

export const DUTY_TTL_MS = 3 * 60 * 1000;

export type DutyState = { onDuty: boolean; holder: string | null; expiresAt: string | null };

type InstanceRow = {
  instance: string; kind: string; environment: string; version: string | null; last_seen_at: string;
  last_tool_at: string | null; duty_heartbeat_at: string | null; on_duty: number;
};

/** Called on every authenticated agent call: remembers who is out there and when they last did something. */
export function touchInstance(
  sqlite: Database.Database, agent: Pick<TrustedAgent, "instance" | "kind" | "environment">,
  options: { tool?: boolean; version?: string | null; now?: Date } = {},
): void {
  const now = (options.now ?? new Date()).toISOString();
  sqlite.prepare(
    `INSERT INTO agent_instances (instance, kind, environment, version, last_seen_at, last_tool_at, on_duty)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(instance) DO UPDATE SET kind = excluded.kind, environment = excluded.environment,
       version = COALESCE(excluded.version, agent_instances.version), last_seen_at = excluded.last_seen_at,
       last_tool_at = COALESCE(excluded.last_tool_at, agent_instances.last_tool_at)`,
  ).run(agent.instance, agent.kind, agent.environment, options.version ?? null, now, options.tool ? now : null);
}

export function currentDuty(sqlite: Database.Database, now = new Date()): { instance: string; expiresAt: string; lastSeenAt: string } | null {
  const cutoff = new Date(now.getTime() - DUTY_TTL_MS).toISOString();
  const row = sqlite.prepare(
    "SELECT * FROM agent_instances WHERE on_duty = 1 AND duty_heartbeat_at IS NOT NULL AND duty_heartbeat_at > ? ORDER BY duty_heartbeat_at DESC LIMIT 1",
  ).get(cutoff) as InstanceRow | undefined;
  return row ? {
    instance: row.instance,
    lastSeenAt: row.duty_heartbeat_at!,
    expiresAt: new Date(Date.parse(row.duty_heartbeat_at!) + DUTY_TTL_MS).toISOString(),
  } : null;
}

export function isOnDuty(sqlite: Database.Database, instance: string, now = new Date()): boolean {
  return currentDuty(sqlite, now)?.instance === instance;
}

/** The first live caller holds duty, the rest stand by; the holder renews with each heartbeat. Only keys that may supervise can hold it. */
export function dutyHeartbeat(
  sqlite: Database.Database, agent: TrustedAgent, version: string | null, now = new Date(),
): DutyState {
  const live = currentDuty(sqlite, now);
  if (!agent.canSupervise) return { onDuty: false, holder: live?.instance ?? null, expiresAt: live?.expiresAt ?? null };
  const nowIso = now.toISOString();
  touchInstance(sqlite, agent, { version, now });
  if (live && live.instance !== agent.instance) return { onDuty: false, holder: live.instance, expiresAt: live.expiresAt };
  const previous = sqlite.prepare("SELECT instance FROM agent_instances WHERE on_duty = 1").all() as Array<{ instance: string }>;
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE agent_instances SET on_duty = 0 WHERE on_duty = 1 AND instance != ?").run(agent.instance);
    sqlite.prepare("UPDATE agent_instances SET on_duty = 1, duty_heartbeat_at = ? WHERE instance = ?").run(nowIso, agent.instance);
  })();
  const wasHolder = live?.instance === agent.instance;
  if (!wasHolder) {
    const stale = previous.find((item) => item.instance !== agent.instance);
    if (stale) publishAgentEvent({ type: "hermes.duty_lost", summary: `${stale.instance} hết hạn trực.` });
    publishAgentEvent({ type: "hermes.duty_taken", summary: `${agent.instance} nhận trực.` });
  }
  return { onDuty: true, holder: agent.instance, expiresAt: new Date(now.getTime() + DUTY_TTL_MS).toISOString() };
}

/** Marks an expired holder off duty. Returns the instance that just lost duty, if any. */
export function sweepDuty(sqlite: Database.Database, now = new Date()): string | null {
  if (currentDuty(sqlite, now)) return null;
  const stale = sqlite.prepare("SELECT instance FROM agent_instances WHERE on_duty = 1").all() as Array<{ instance: string }>;
  if (!stale.length) return null;
  sqlite.prepare("UPDATE agent_instances SET on_duty = 0 WHERE on_duty = 1").run();
  publishAgentEvent({ type: "hermes.duty_lost", summary: `${stale[0]!.instance} hết hạn trực.` });
  return stale[0]!.instance;
}

export function listInstances(sqlite: Database.Database, now = new Date()): Array<{
  instance: string; kind: string; environment: string; version: string | null; lastSeenAt: string; lastToolAt: string | null; onDuty: boolean;
}> {
  const duty = currentDuty(sqlite, now)?.instance;
  return (sqlite.prepare("SELECT * FROM agent_instances ORDER BY last_seen_at DESC LIMIT 50").all() as InstanceRow[]).map((row) => ({
    instance: row.instance, kind: row.kind, environment: row.environment, version: row.version,
    lastSeenAt: row.last_seen_at, lastToolAt: row.last_tool_at, onDuty: row.instance === duty,
  }));
}

/** Last moment any supervisor was on duty (for the "Hermes offline" rule). */
export function lastDutyAt(sqlite: Database.Database): string | null {
  const row = sqlite.prepare("SELECT MAX(duty_heartbeat_at) AS at FROM agent_instances").get() as { at: string | null };
  return row.at;
}
