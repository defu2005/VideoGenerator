import type Database from "better-sqlite3";
import {
  CUSTOM_PROVIDER_SLUG,
  LlmConnectionSettingsSchema,
  SECRET_ENV_NAMES,
  STATIC_SECRET_IDS,
  isSecretId,
  isStaticSecretId,
  type LlmConnectionSettings,
  type SecretId,
  type SecretStatus,
  type StaticSecretId,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { AppConfig } from "../lib/config.js";
import type { TokenVault } from "../publishing/tokenVault.js";

export const LLM_CONNECTION_SETTINGS_KEY = "llmProviders";

type ConfigKey = keyof AppConfig;
type Writable = Record<string, unknown>;

/** Non-secret LLM settings the app can override. Built-in id → config field. */
const BASE_URL_FIELDS: Record<string, ConfigKey> = {
  openai: "OPENAI_BASE_URL",
  ollama: "OLLAMA_BASE_URL",
  "remote-ollama": "REMOTE_OLLAMA_BASE_URL",
  omniroute: "OMNIROUTE_BASE_URL",
  opencode: "OPENCODE_BASE_URL",
  custom: "CUSTOM_LLM_BASE_URL",
};
const MODEL_FIELDS: Record<string, ConfigKey> = {
  anthropic: "ANTHROPIC_MODEL",
  gemini: "GEMINI_MODEL",
  openai: "OPENAI_MODEL",
  ollama: "OLLAMA_MODEL",
  "remote-ollama": "REMOTE_OLLAMA_MODEL",
  openrouter: "OPENROUTER_MODEL",
  deepseek: "DEEPSEEK_MODEL",
  groq: "GROQ_MODEL",
  omniroute: "OMNIROUTE_MODEL",
  opencode: "OPENCODE_MODEL",
  custom: "CUSTOM_LLM_MODEL",
};
const CLI_FIELDS: Record<"claude-cli" | "copilot-cli" | "antigravity-cli", { enabled: ConfigKey; path: ConfigKey; model: ConfigKey }> = {
  "claude-cli": { enabled: "CLAUDE_CLI_ENABLED", path: "CLAUDE_CLI_PATH", model: "CLAUDE_CLI_MODEL" },
  "copilot-cli": { enabled: "COPILOT_CLI_ENABLED", path: "COPILOT_CLI_PATH", model: "COPILOT_CLI_MODEL" },
  "antigravity-cli": { enabled: "ANTIGRAVITY_CLI_ENABLED", path: "ANTIGRAVITY_CLI_PATH", model: "ANTIGRAVITY_CLI_MODEL" },
};

const PLATFORM_APP_FIELDS: Partial<Record<StaticSecretId, [ConfigKey, ConfigKey]>> = {
  "platform.youtube.app": ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  "platform.tiktok.app": ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  "platform.meta.app": ["META_APP_ID", "META_APP_SECRET"],
};

type ReadResult = { value: string } | { unreadable: true } | null;

/**
 * Keys saved in the app win over `.env`. The store keeps a copy of the `.env` values it
 * started with and writes the effective values onto the shared config object, so code that
 * reads `config.X` at call time sees a key saved in the app without a restart.
 */
export class SecretStore {
  private readonly envSnapshot = new Map<ConfigKey, unknown>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly config: AppConfig,
    private readonly vault: TokenVault,
    private readonly sqlite: Database.Database,
  ) {
    const fields = new Set<ConfigKey>();
    for (const id of STATIC_SECRET_IDS) {
      for (const name of SECRET_ENV_NAMES[id]) fields.add(name as ConfigKey);
    }
    for (const field of [...Object.values(BASE_URL_FIELDS), ...Object.values(MODEL_FIELDS)]) fields.add(field);
    for (const cli of Object.values(CLI_FIELDS)) {
      fields.add(cli.enabled); fields.add(cli.path); fields.add(cli.model);
    }
    for (const field of fields) this.envSnapshot.set(field, (config as Writable)[field]);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Effective value: app vault → `.env` → none. An unreadable vault entry falls back to `.env`. */
  resolve(id: SecretId): string | undefined {
    const stored = this.read(id);
    if (stored && "value" in stored) return stored.value;
    return this.envValue(id);
  }

  /** For a platform app secret: `{ clientId, clientSecret }`. */
  resolveApp(id: StaticSecretId): { clientId: string; clientSecret: string } | undefined {
    const raw = this.resolve(id);
    if (!raw) return undefined;
    return parseAppSecret(raw) ?? undefined;
  }

  describe(id: SecretId): SecretStatus {
    const envNames = isStaticSecretId(id) ? [...SECRET_ENV_NAMES[id]] : [];
    const stored = this.read(id);
    if (stored && "unreadable" in stored) {
      return { id, configured: false, source: "app", hint: null, updatedAt: this.updatedAt(id), error: "UNREADABLE", envNames };
    }
    if (stored) {
      return { id, configured: true, source: "app", hint: hintOf(id, stored.value), updatedAt: this.updatedAt(id), envNames };
    }
    const env = this.envValue(id);
    if (env) return { id, configured: true, source: "env", hint: hintOf(id, env), updatedAt: null, envNames };
    return { id, configured: false, source: "none", hint: null, updatedAt: null, envNames };
  }

  /** Trims the value; an empty value removes the saved key. Never logs the value. */
  save(id: string, value: string): SecretStatus {
    const secretId = requireSecretId(id);
    const trimmed = value.trim();
    if (!trimmed) return this.remove(secretId);
    if (trimmed.length > 4096) throw new AppError(400, "SECRET_TOO_LONG", "Key quá dài.");
    if (PLATFORM_APP_FIELDS[secretId as StaticSecretId] && !parseAppSecret(trimmed)) {
      throw new AppError(400, "SECRET_INVALID", "Cần cả client id và client secret.");
    }
    this.vault.storeSecret(vaultKey(secretId), trimmed);
    this.changed();
    return this.describe(secretId);
  }

  saveApp(id: StaticSecretId, credentials: { clientId: string; clientSecret: string }): SecretStatus {
    const clientId = credentials.clientId.trim();
    const clientSecret = credentials.clientSecret.trim();
    if (!clientId && !clientSecret) return this.remove(id);
    if (!clientId || !clientSecret) throw new AppError(400, "SECRET_INVALID", "Cần cả client id và client secret.");
    return this.save(id, JSON.stringify({ clientId, clientSecret }));
  }

  remove(id: string): SecretStatus {
    const secretId = requireSecretId(id);
    this.vault.deleteSecret(vaultKey(secretId));
    this.changed();
    return this.describe(secretId);
  }

  /** Copies `.env` values into the app vault where the app has none yet. Returns ids only. */
  importEnv(): string[] {
    const copied: string[] = [];
    for (const id of STATIC_SECRET_IDS) {
      if (this.vault.hasSecret(vaultKey(id))) continue;
      const env = this.envValue(id);
      if (!env) continue;
      this.vault.storeSecret(vaultKey(id), env);
      copied.push(id);
    }
    if (copied.length) this.changed();
    return copied;
  }

  llmSettings(): LlmConnectionSettings {
    const row = this.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(LLM_CONNECTION_SETTINGS_KEY) as
      | { value: string } | undefined;
    if (!row) return LlmConnectionSettingsSchema.parse({});
    try {
      const parsed = LlmConnectionSettingsSchema.safeParse(JSON.parse(row.value));
      return parsed.success ? parsed.data : LlmConnectionSettingsSchema.parse({});
    } catch {
      return LlmConnectionSettingsSchema.parse({});
    }
  }

  saveLlmSettings(settings: LlmConnectionSettings): LlmConnectionSettings {
    const parsed = LlmConnectionSettingsSchema.parse(settings);
    const slugs = new Set<string>();
    for (const custom of parsed.custom) {
      if (!CUSTOM_PROVIDER_SLUG.test(custom.slug) || slugs.has(custom.slug)) {
        throw new AppError(400, "CUSTOM_PROVIDER_INVALID", `Tên ngắn "${custom.slug}" không hợp lệ hoặc bị trùng.`);
      }
      slugs.add(custom.slug);
    }
    this.sqlite.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(LLM_CONNECTION_SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
    this.changed();
    return parsed;
  }

  /** Writes effective values onto the shared config object. */
  apply(): void {
    const target = this.config as Writable;
    for (const id of STATIC_SECRET_IDS) {
      const appFields = PLATFORM_APP_FIELDS[id];
      if (appFields) {
        const stored = this.read(id);
        const app = stored && "value" in stored ? parseAppSecret(stored.value) : null;
        target[appFields[0]] = app?.clientId ?? this.envSnapshot.get(appFields[0]);
        target[appFields[1]] = app?.clientSecret ?? this.envSnapshot.get(appFields[1]);
        continue;
      }
      const field = SECRET_ENV_NAMES[id][0] as ConfigKey;
      const stored = this.read(id);
      target[field] = stored && "value" in stored ? stored.value : this.envSnapshot.get(field);
    }
    const settings = this.llmSettings();
    for (const [id, field] of Object.entries(BASE_URL_FIELDS)) {
      target[field] = settings.providers[id]?.baseUrl ?? this.envSnapshot.get(field);
    }
    for (const [id, field] of Object.entries(MODEL_FIELDS)) {
      target[field] = settings.providers[id]?.defaultModel ?? this.envSnapshot.get(field);
    }
    for (const [id, fields] of Object.entries(CLI_FIELDS)) {
      const cli = settings.cli[id as keyof typeof CLI_FIELDS];
      target[fields.enabled] = cli ? cli.enabled : this.envSnapshot.get(fields.enabled);
      target[fields.path] = cli?.path || this.envSnapshot.get(fields.path);
      target[fields.model] = cli?.model || this.envSnapshot.get(fields.model);
    }
  }

  /** `.env` value as it was when the app started. */
  envValue(id: SecretId): string | undefined {
    if (!isStaticSecretId(id)) return undefined;
    const names = SECRET_ENV_NAMES[id];
    const values = names.map((name) => this.envSnapshot.get(name as ConfigKey));
    if (values.some((value) => typeof value !== "string" || !value.trim())) return undefined;
    if (PLATFORM_APP_FIELDS[id]) return JSON.stringify({ clientId: values[0], clientSecret: values[1] });
    return values[0] as string;
  }

  private changed(): void {
    this.apply();
    for (const listener of this.listeners) {
      try { listener(); } catch { /* a listener must not break saving */ }
    }
  }

  private read(id: SecretId): ReadResult {
    if (!this.vault.hasSecret(vaultKey(id))) return null;
    try {
      const value = this.vault.loadSecret(vaultKey(id));
      return value ? { value } : null;
    } catch {
      return { unreadable: true };
    }
  }

  private updatedAt(id: SecretId): string | null {
    const row = this.sqlite.prepare("SELECT updated_at FROM app_secrets WHERE key = ?").get(vaultKey(id)) as
      | { updated_at: string } | undefined;
    return row?.updated_at ?? null;
  }
}

export function vaultKey(id: SecretId): string {
  return `connections.${id}`;
}

export function requireSecretId(id: string): SecretId {
  if (!isSecretId(id)) throw new AppError(400, "SECRET_UNKNOWN", "Không có loại key này.");
  return id;
}

function parseAppSecret(raw: string): { clientId: string; clientSecret: string } | null {
  try {
    const value = JSON.parse(raw) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof value.clientId === "string" && value.clientId && typeof value.clientSecret === "string" && value.clientSecret) {
      return { clientId: value.clientId, clientSecret: value.clientSecret };
    }
  } catch { /* not JSON */ }
  return null;
}

/** Last 4 characters; for an app secret, of the client id. */
function hintOf(id: SecretId, value: string): string {
  const source = isStaticSecretId(id) && PLATFORM_APP_FIELDS[id] ? parseAppSecret(value)?.clientId ?? "" : value;
  return source.length > 8 ? `…${source.slice(-4)}` : "…";
}
