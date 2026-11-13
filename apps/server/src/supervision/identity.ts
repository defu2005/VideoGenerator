import type Database from "better-sqlite3";
import { parseAgentIdentity, type AgentIdentity } from "../reports/agentIdentity.js";

export const AGENT_KINDS = ["operator", "assistant", "hermes", "codex", "cursor", "claude", "other"] as const;
const LABEL = /^[A-Za-z0-9 ._-]{1,64}$/;

export type TrustedAgent = AgentIdentity & {
  /** `kind/name`: the one id used for leases, duty and audit. */
  instance: string;
  canSupervise: boolean;
  /** True when the kind came from a machine key (or the app itself), not from a header. */
  trusted: boolean;
};

export type KeyProfile = { keyId: string; agentKind: string; instanceName: string; canSupervise: boolean };

/** The in-process operator: no key, always trusted, never allowed to supervise. */
export const INTERNAL_OPERATOR: TrustedAgent = {
  kind: "operator", name: "app", model: null, environment: "app",
  instance: "operator/app", canSupervise: false, trusted: true,
};

export function getKeyProfile(sqlite: Database.Database, keyId: string | undefined | null): KeyProfile | null {
  if (!keyId) return null;
  const row = sqlite.prepare(
    "SELECT key_id, agent_kind, instance_name, can_supervise FROM agent_key_profiles WHERE key_id = ?",
  ).get(keyId) as { key_id: string; agent_kind: string; instance_name: string; can_supervise: number } | undefined;
  return row ? { keyId: row.key_id, agentKind: row.agent_kind, instanceName: row.instance_name, canSupervise: row.can_supervise === 1 } : null;
}

export function listKeyProfiles(sqlite: Database.Database): KeyProfile[] {
  return (sqlite.prepare("SELECT key_id, agent_kind, instance_name, can_supervise FROM agent_key_profiles").all() as
    Array<{ key_id: string; agent_kind: string; instance_name: string; can_supervise: number }>)
    .map((row) => ({ keyId: row.key_id, agentKind: row.agent_kind, instanceName: row.instance_name, canSupervise: row.can_supervise === 1 }));
}

/** Only the instance owner's UI calls this (keys route). Agents can never reach it: policy rule 4 blocks the field names. */
export function saveKeyProfile(
  sqlite: Database.Database,
  keyId: string,
  patch: { agentKind?: string; instanceName?: string; canSupervise?: boolean },
  now = new Date(),
): KeyProfile {
  const current = getKeyProfile(sqlite, keyId) ?? { keyId, agentKind: "other", instanceName: "unknown", canSupervise: false };
  const kind = patch.agentKind ?? current.agentKind;
  if (!(AGENT_KINDS as readonly string[]).includes(kind)) throw new Error("Loại agent không hợp lệ.");
  const name = patch.instanceName === undefined ? current.instanceName : patch.instanceName.trim();
  if (!LABEL.test(name)) throw new Error("Tên instance chỉ gồm chữ, số, dấu cách . _ - (tối đa 64).");
  const supervise = patch.canSupervise ?? current.canSupervise;
  sqlite.prepare(
    `INSERT INTO agent_key_profiles (key_id, agent_kind, instance_name, can_supervise, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key_id) DO UPDATE SET agent_kind = excluded.agent_kind, instance_name = excluded.instance_name,
       can_supervise = excluded.can_supervise, updated_at = excluded.updated_at`,
  ).run(keyId, kind, name, supervise ? 1 : 0, now.toISOString());
  return { keyId, agentKind: kind, instanceName: name, canSupervise: supervise };
}

/**
 * The caller's identity. The kind and supervise right come from the machine key; headers only add
 * labels (model, environment) and the instance name when the key has none. A header that claims another
 * kind is ignored and logged.
 */
export function resolveTrustedAgent(input: {
  sqlite: Database.Database;
  keyId?: string | null;
  headers: Record<string, string | undefined>;
  warn?: (data: Record<string, unknown>, message: string) => void;
}): TrustedAgent {
  const profile = getKeyProfile(input.sqlite, input.keyId);
  const kind = profile?.agentKind ?? "other";
  const parsed = parseAgentIdentity(input.headers, {
    kind,
    onMismatch: (claimed) => input.warn?.({ keyId: input.keyId, claimed, actual: kind }, "agent kind header ignored: key says otherwise"),
  });
  const name = profile && profile.instanceName !== "unknown" ? profile.instanceName : parsed.name;
  return {
    ...parsed,
    kind,
    name,
    instance: `${kind}/${name}`,
    canSupervise: profile?.canSupervise === true,
    trusted: profile !== null,
  };
}
