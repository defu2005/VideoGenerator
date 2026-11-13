import type Database from "better-sqlite3";
import { scopeSql } from "../auth/requestContext.js";
import { touchFromOwner } from "../operator/autopilot.js";
import { listKeyProfiles, saveKeyProfile } from "../supervision/identity.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AccountListRowSchema,
  CONNECTION_CATALOG,
  ConnectionCheckSchema,
  LlmConnectionUpdateSchema,
  LlmCustomProviderInputSchema,
  LlmProviderIdSchema,
  PlatformAppSaveSchema,
  PlatformIdSchema,
  STATIC_SECRET_IDS,
  SecretSaveSchema,
  connectionCatalogEntry,
  customSecretId,
  isStaticSecretId,
  platformAppSecretId,
  validatePlatformAppInput,
  type AccountListRow,
  type ConnectionCheck,
  type ConnectionOverviewRow,
  type ConnectionsOverview,
  type LlmConnectionRow,
  type LlmConnectionSettings,
  type PlatformAppStatus,
  type SecretRow,
  type SecretStatus,
  type StaticSecretId,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { requireValidPlatformApp } from "../publishing/appCredentialValidation.js";
import type { AppConfig } from "../lib/config.js";
import type { SecretStore } from "../settings/secrets.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import type { OAuthStateStore } from "../publishing/oauthState.js";
import type { PublishService } from "../publishing/publishService.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import type { TtsProviderRegistry } from "../providers/tts/registry.js";
import { ImageProviderRegistry } from "../providers/images/registry.js";
import { BraveImageProvider } from "../providers/images/brave.js";
import { omniRouteBaseUrl } from "../providers/llm/omnirouteCatalog.js";
import { getImageSourcesSettingsStatus } from "../settings/imageSources.js";
import { TELEGRAM_BOT_TOKEN_KEY } from "../settings/notifications.js";
import { marketAccountWarning } from "../knowledge/markets.js";

export const CONNECTION_CHECKS_KEY = "connections.checks";
export const SETUP_HIDDEN_KEY = "connections.setupHidden";
const TEST_TIMEOUT_MS = 10_000;
const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";

type CliId = "claude-cli" | "copilot-cli" | "antigravity-cli";
const CLI_IDS: CliId[] = ["claude-cli", "copilot-cli", "antigravity-cli"];
const CLI_LABELS: Record<CliId, string> = {
  "claude-cli": "Claude Code CLI",
  "copilot-cli": "GitHub Copilot CLI",
  "antigravity-cli": "Antigravity CLI",
};
const CLI_HOW_TO: Record<CliId, string[]> = {
  "claude-cli": ["Cài Claude Code và đăng nhập một lần trong terminal.", "Bật ở đây; để trống đường dẫn nếu lệnh claude đã có trong PATH."],
  "copilot-cli": ["Cài GitHub Copilot CLI và đăng nhập một lần.", "Bật ở đây; để trống đường dẫn nếu lệnh copilot đã có trong PATH."],
  "antigravity-cli": ["Cài agy và chạy agy một lần để đăng nhập Google.", "Bật ở đây; để trống đường dẫn nếu lệnh agy đã có trong PATH."],
};
const LLM_LABELS: Record<string, string> = Object.fromEntries(
  CONNECTION_CATALOG.filter((entry) => entry.kind === "llm").map((entry) => [entry.id, entry.label]),
);

export type ConnectionRouteDeps = {
  store: SecretStore;
  registry: LlmProviderRegistry;
  sqlite: Database.Database;
  config: AppConfig;
  oauthState: OAuthStateStore;
  publish: PublishService;
  vault: TokenVault;
  tts: TtsProviderRegistry;
};

const IdParams = z.object({ id: z.string().min(1).max(80) });
const SlugParams = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/) });

export function registerConnectionRoutes(app: FastifyInstance, deps: ConnectionRouteDeps): void {
  const { store, registry, sqlite, config } = deps;

  // ---------- Machine keys / Agent key profiles ----------

  app.get("/api/settings/agent-keys", async () => ({
    profiles: listKeyProfiles(deps.sqlite),
  }));

  app.put("/api/settings/agent-keys/:keyId", async (request) => {
    const { keyId } = z.object({ keyId: z.string().min(1).max(80) }).parse(request.params);
    const body = z.object({
      agentKind: z.string().optional(),
      instanceName: z.string().optional(),
      canSupervise: z.boolean().optional(),
    }).strict().parse(request.body ?? {});
    return saveKeyProfile(deps.sqlite, keyId, body);
  });

  // ---------- AI providers ----------

  app.get("/api/settings/llm-providers", async () => ({ providers: llmRows(deps) }));

  app.put("/api/settings/llm-providers/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = LlmConnectionUpdateSchema.parse(request.body ?? {});
    const settings = structuredClone(store.llmSettings());
    if (isCliId(id)) {
      const current = settings.cli[id];
      settings.cli[id] = {
        enabled: body.enabled ?? current?.enabled ?? Boolean(cliEnabled(config, id)),
        ...(body.cliPath !== undefined ? (body.cliPath ? { path: body.cliPath } : {}) : current?.path ? { path: current.path } : {}),
        ...(body.defaultModel !== undefined ? (body.defaultModel ? { model: body.defaultModel } : {}) : current?.model ? { model: current.model } : {}),
      };
      if (body.apiKey) throw new AppError(400, "KEY_NOT_USED", "CLI không dùng key; đăng nhập trong terminal.");
      store.saveLlmSettings(settings);
      touchFromOwner(request.headers, deps.sqlite, "llm:routing");
      return requireRow(deps, id);
    }
    const slug = customSlug(id);
    if (slug) {
      const custom = settings.custom.find((entry) => entry.slug === slug);
      if (!custom) throw new AppError(404, "PROVIDER_NOT_FOUND", "Không có nhà cung cấp này.");
      if (body.label) custom.label = body.label;
      if (body.baseUrl) custom.baseUrl = body.baseUrl;
      if (body.defaultModel !== undefined) custom.defaultModel = body.defaultModel || undefined;
      if (body.embeddings !== undefined) custom.embeddings = body.embeddings;
      if (body.vision !== undefined) custom.vision = body.vision ?? undefined;
      if (body.enabled !== undefined) custom.enabled = body.enabled;
      if (body.apiKey?.trim()) store.save(customSecretId(slug), body.apiKey);
      store.saveLlmSettings(dropUndefined(settings));
      return requireRow(deps, id);
    }
    if (!isBuiltInLlm(id)) throw new AppError(404, "PROVIDER_NOT_FOUND", "Không có nhà cung cấp này.");
    const current = { ...(settings.providers[id] ?? { enabled: true }) };
    if (body.enabled !== undefined) current.enabled = body.enabled;
    if (body.baseUrl !== undefined) current.baseUrl = body.baseUrl || undefined;
    if (body.defaultModel !== undefined) current.defaultModel = body.defaultModel || undefined;
    if (body.embeddings !== undefined) current.embeddings = body.embeddings;
    if (body.vision !== undefined) current.vision = body.vision ?? undefined;
    settings.providers[id] = current;
    if (body.apiKey?.trim()) {
      const secretId = llmSecretId(id);
      if (!secretId) throw new AppError(400, "KEY_NOT_USED", "Nhà cung cấp này không dùng key.");
      store.save(secretId, body.apiKey);
    }
    store.saveLlmSettings(dropUndefined(settings));
    return requireRow(deps, id);
  });

  app.delete("/api/settings/llm-providers/:id/key", async (request) => {
    const { id } = IdParams.parse(request.params);
    const slug = customSlug(id);
    const secretId = slug ? customSecretId(slug) : llmSecretId(id);
    if (!secretId) throw new AppError(400, "KEY_NOT_USED", "Nhà cung cấp này không dùng key.");
    store.remove(secretId);
    return requireRow(deps, id);
  });

  app.post("/api/settings/llm-providers/custom", async (request) => {
    const body = LlmCustomProviderInputSchema.parse(request.body ?? {});
    const settings = structuredClone(store.llmSettings());
    if (settings.custom.some((entry) => entry.slug === body.slug)) {
      throw new AppError(409, "CUSTOM_PROVIDER_EXISTS", `Tên ngắn "${body.slug}" đã có.`);
    }
    settings.custom.push({
      slug: body.slug,
      label: body.label,
      baseUrl: body.baseUrl,
      ...(body.defaultModel ? { defaultModel: body.defaultModel } : {}),
      ...(body.embeddings !== undefined ? { embeddings: body.embeddings } : {}),
      ...(body.vision !== undefined ? { vision: body.vision } : {}),
      enabled: true,
    });
    if (body.apiKey?.trim()) store.save(customSecretId(body.slug), body.apiKey);
    store.saveLlmSettings(settings);
    return requireRow(deps, `custom-${body.slug}`);
  });

  app.delete("/api/settings/llm-providers/custom/:slug", async (request) => {
    const { slug } = SlugParams.parse(request.params);
    const settings = structuredClone(store.llmSettings());
    const before = settings.custom.length;
    settings.custom = settings.custom.filter((entry) => entry.slug !== slug);
    if (settings.custom.length === before) throw new AppError(404, "PROVIDER_NOT_FOUND", "Không có nhà cung cấp này.");
    store.remove(customSecretId(slug));
    store.saveLlmSettings(settings);
    return { ok: true as const };
  });

  app.post("/api/settings/llm-providers/:id/test", async (request) => {
    const { id } = IdParams.parse(request.params);
    requireRow(deps, id);
    const check = await testLlm(deps, id);
    writeCheck(sqlite, `llm:${id}`, check);
    return check;
  });

  // OpenRouter: OAuth PKCE hands the app a user API key.
  app.post("/api/settings/llm-providers/openrouter/start", async () => {
    const callback = `http://127.0.0.1:${config.PORT}/api/settings/llm-providers/openrouter/callback`;
    const { state, codeChallenge } = deps.oauthState.create({ accountId: "llm", platform: "openrouter-key", redirectUri: callback });
    const url = new URL(OPENROUTER_AUTH_URL);
    url.searchParams.set("callback_url", `${callback}?state=${encodeURIComponent(state)}`);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString() };
  });

  app.get("/api/settings/llm-providers/openrouter/callback", async (request, reply) => {
    const query = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional() }).parse(request.query);
    const pending = query.state ? deps.oauthState.take(query.state) : null;
    if (!pending || pending.platform !== "openrouter-key") {
      throw new AppError(400, "OAUTH_STATE_INVALID", "Phiên đăng nhập đã hết hạn hoặc đã dùng. Hãy bấm Đăng nhập lại.");
    }
    const back = new URL("/settings/connections", config.WEB_BASE_URL);
    if (!query.code) {
      back.searchParams.set("error", "openrouter");
      return reply.redirect(back.toString());
    }
    try {
      const response = await globalThis.fetch(OPENROUTER_KEYS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: query.code, code_verifier: pending.codeVerifier, code_challenge_method: "S256" }),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      const payload = response.ok ? await response.json() as { key?: unknown } : null;
      if (!payload || typeof payload.key !== "string" || !payload.key) throw new Error("no key");
      store.save("llm.openrouter.apiKey", payload.key);
      back.searchParams.set("connected", "openrouter");
    } catch {
      back.searchParams.set("error", "openrouter");
    }
    return reply.redirect(back.toString());
  });

  // ---------- .env import ----------

  app.get("/api/settings/import-env", async () => ({ ids: importableIds(store) }));
  app.post("/api/settings/import-env", async () => ({ copied: store.importEnv() }));

  // ---------- Image sources, Brave, platform apps ----------

  app.get("/api/connections/secrets", async () => ({ secrets: secretRows(deps) }));

  app.put("/api/connections/secrets/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const secretId = requireNonLlmSecret(id);
    const body = SecretSaveSchema.parse(request.body ?? {});
    if ("value" in body) store.save(secretId, body.value);
    else {
      if (!platformAppIds().includes(secretId)) throw new AppError(400, "SECRET_INVALID", "Key này chỉ có một giá trị.");
      requireValidPlatformApp(secretId === "platform.youtube.app" ? "youtube" : secretId === "platform.meta.app" ? "facebook_reels" : "tiktok", body);
      store.saveApp(secretId, body);
    }
    return requireSecretRow(deps, secretId);
  });

  app.delete("/api/connections/secrets/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const secretId = requireNonLlmSecret(id);
    store.remove(secretId);
    return requireSecretRow(deps, secretId);
  });

  app.post("/api/connections/secrets/:id/test", async (request) => {
    const { id } = IdParams.parse(request.params);
    const secretId = requireNonLlmSecret(id);
    const row = requireSecretRow(deps, secretId);
    const check = await testSecret(deps, row);
    writeCheck(sqlite, `secret:${row.connectionId}`, check);
    return check;
  });

  // ---------- Overview and first-run checklist ----------

  app.get("/api/connections/overview", async () => overview(deps));

  app.put("/api/connections/setup", async (request) => {
    const body = z.object({ hidden: z.boolean() }).strict().parse(request.body ?? {});
    writeSetting(sqlite, SETUP_HIDDEN_KEY, body.hidden);
    return overview(deps);
  });

  // ---------- Platform accounts across profiles ----------

  app.get("/api/accounts", async () => ({ accounts: listAllAccounts(deps) }));

  app.get("/api/accounts/duplicates", async (request) => {
    const query = z.object({
      platform: PlatformIdSchema,
      externalId: z.string().min(1).max(200),
      excludeId: z.string().max(80).optional(),
    }).parse(request.query);
    const rows = sqlite.prepare(
      `SELECT a.id, a.profile_id, a.display_name, p.name AS profile_name
       FROM platform_accounts a JOIN profiles p ON p.id = a.profile_id
       WHERE a.platform = ? AND a.external_id = ? AND a.id != ? AND ${scopeSql("p.workspace_id", "p.id").sql}`,
    ).all(query.platform, query.externalId, query.excludeId ?? "", ...scopeSql("p.workspace_id", "p.id").args) as Array<{
      id: string; profile_id: string; display_name: string; profile_name: string;
    }>;
    return {
      duplicates: rows.map((row) => ({ id: row.id, profileId: row.profile_id, profileName: row.profile_name, displayName: row.display_name })),
    };
  });

  app.post("/api/accounts/:id/move", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ profileId: z.string().uuid() }).strict().parse(request.body ?? {});
    const account = deps.publish.requireAccount(id);
    const profile = sqlite.prepare("SELECT id FROM profiles WHERE id = ?").get(body.profileId);
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Không tìm thấy hồ sơ.");
    if (account.profile_id === body.profileId) return requireAccountRow(deps, id);
    const uploading = sqlite.prepare(
      "SELECT 1 FROM publications WHERE account_id = ? AND status = 'UPLOADING' LIMIT 1",
    ).get(id);
    if (uploading) throw new AppError(409, "ACCOUNT_BUSY", "Tài khoản đang tải video lên. Hãy chờ xong rồi chuyển.");
    sqlite.prepare("UPDATE platform_accounts SET profile_id = ?, updated_at = ? WHERE id = ?")
      .run(body.profileId, new Date().toISOString(), id);
    return requireAccountRow(deps, id);
  });

  // ---------- Developer apps for the Thêm tài khoản wizard ----------

  app.get("/api/connections/platform-apps/:platform", async (request) => {
    const { platform } = z.object({ platform: PlatformIdSchema }).parse(request.params);
    const query = z.object({ profileId: z.string().max(80).optional(), accountId: z.string().max(80).optional() }).parse(request.query);
    return platformAppStatus(deps, platform, query.profileId, query.accountId);
  });

  app.put("/api/connections/platform-apps/:platform", async (request) => {
    const { platform } = z.object({ platform: PlatformIdSchema }).parse(request.params);
    const body = PlatformAppSaveSchema.parse(request.body ?? {});
    const secretId = platformAppSecretId(platform);
    if (!secretId) throw new AppError(400, "PLATFORM_NO_APP", "Nền tảng này không cần ứng dụng nhà phát triển.");
    requireValidPlatformApp(platform, body);
    if (body.scope === "app") {
      store.saveApp(secretId, { clientId: body.clientId, clientSecret: body.clientSecret });
    } else {
      if (!body.profileId) throw new AppError(400, "PROFILE_REQUIRED", "Chọn hồ sơ trước.");
      deps.vault.storeAppCredentials({ profileId: body.profileId, platform, credentials: { clientId: body.clientId, clientSecret: body.clientSecret } });
    }
    return platformAppStatus(deps, platform, body.profileId);
  });

  app.post("/api/connections/platform-apps/:platform/verify", async (request) => {
    const { platform } = z.object({ platform: PlatformIdSchema }).parse(request.params);
    const query = z.object({ profileId: z.string().max(80).optional(), accountId: z.string().max(80).optional() }).parse(request.query);
    if (platform !== "youtube") return { ok: null, reason: "Nền tảng này chưa hỗ trợ kiểm tra trước" };
    const credentials = effectivePlatformApp(deps, platform, query.profileId, query.accountId);
    if (!credentials) return { ok: false, reason: "Hãy lưu ứng dụng trước khi kiểm tra." };
    const validation = validatePlatformAppInput(platform, credentials);
    if (!validation.ok) return { ok: false, reason: Object.values(validation.errors).join(" ") };
    const redirectUri = deps.publish.oauthRedirectUri(platform);
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        redirect: "error",
        body: new URLSearchParams({ grant_type: "authorization_code", code: "video-agent-credential-check",
          client_id: credentials.clientId, client_secret: credentials.clientSecret, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(10_000),
      });
      const { error } = await response.json() as { error?: unknown };
      if (error === "invalid_grant") return { ok: true };
      if (error === "invalid_client" || error === "unauthorized_client") return { ok: false, reason: "Google không nhận Client ID hoặc Client Secret này" };
      if (error === "redirect_uri_mismatch") return { ok: false, reason: `Thêm đúng redirect URI này vào ứng dụng: ${redirectUri}` };
    } catch {
      return { ok: false, reason: "Không kiểm tra được ứng dụng với Google. Hãy thử lại." };
    }
    return { ok: false, reason: "Google chưa xác nhận được ứng dụng. Kiểm tra thông tin và thử lại." };
  });
}

// ---------- AI rows ----------

function isCliId(id: string): id is CliId {
  return (CLI_IDS as string[]).includes(id);
}

function customSlug(id: string): string | null {
  const match = /^custom-([a-z0-9][a-z0-9-]{0,30})$/.exec(id);
  return match ? match[1]! : null;
}

function isBuiltInLlm(id: string): boolean {
  return LlmProviderIdSchema.safeParse(id).success && id !== "mock" && !isCliId(id);
}

function llmSecretId(id: string): StaticSecretId | null {
  return connectionCatalogEntry(id)?.kind === "llm" ? connectionCatalogEntry(id)!.secrets[0] ?? null : null;
}

function cliEnabled(config: AppConfig, id: CliId): boolean {
  if (id === "claude-cli") return Boolean(config.CLAUDE_CLI_ENABLED);
  if (id === "copilot-cli") return Boolean(config.COPILOT_CLI_ENABLED);
  return Boolean(config.ANTIGRAVITY_CLI_ENABLED);
}

function cliPath(config: AppConfig, id: CliId): string | null {
  const value = id === "claude-cli" ? config.CLAUDE_CLI_PATH : id === "copilot-cli" ? config.COPILOT_CLI_PATH : config.ANTIGRAVITY_CLI_PATH;
  return typeof value === "string" && value ? value : null;
}

function baseUrlOf(config: AppConfig, id: string): string | null {
  switch (id) {
    case "openai": return config.OPENAI_BASE_URL ?? null;
    case "ollama": return config.OLLAMA_BASE_URL ?? null;
    case "remote-ollama": return config.REMOTE_OLLAMA_BASE_URL ?? null;
    case "omniroute": return omniRouteBaseUrl(config);
    case "opencode": return config.OPENCODE_BASE_URL ?? null;
    case "custom": return config.CUSTOM_LLM_BASE_URL ?? null;
    case "openrouter": return "https://openrouter.ai/api/v1";
    case "deepseek": return "https://api.deepseek.com/v1";
    case "groq": return "https://api.groq.com/openai/v1";
    default: return null;
  }
}

function llmRows(deps: ConnectionRouteDeps): LlmConnectionRow[] {
  const { registry, store, config, sqlite } = deps;
  const settings = store.llmSettings();
  const checks = readChecks(sqlite);
  const rows: LlmConnectionRow[] = [];
  for (const id of LlmProviderIdSchema.options) {
    if (id === "mock") continue;
    const provider = registry.get(id);
    if (isCliId(id)) {
      rows.push({
        id, label: CLI_LABELS[id], kind: "cli",
        enabled: cliEnabled(config, id), ready: Boolean(provider), secret: null,
        baseUrl: null, defaultModel: provider?.defaultModel ?? null, vision: null,
        cliPath: cliPath(config, id), keyPageUrl: null, supportsLogin: false,
        howToVi: CLI_HOW_TO[id], pricing: "local", lastCheck: checks[`llm:${id}`] ?? null,
      });
      continue;
    }
    const entry = connectionCatalogEntry(id);
    const secretId = entry?.secrets[0];
    rows.push({
      id,
      label: LLM_LABELS[id] ?? id,
      kind: id === "ollama" || id === "remote-ollama" || id === "omniroute" ? "local" : "api",
      enabled: !registry.isDisabled(id),
      ready: Boolean(provider),
      secret: secretId ? store.describe(secretId) : null,
      baseUrl: baseUrlOf(config, id),
      defaultModel: provider?.defaultModel ?? settings.providers[id]?.defaultModel ?? null,
      embeddings: provider?.capabilities?.embeddings ?? false,
      vision: settings.providers[id]?.vision ?? null,
      cliPath: null,
      keyPageUrl: entry?.keyPageUrl ?? null,
      supportsLogin: Boolean(entry?.supportsLogin),
      howToVi: entry?.howToVi ?? [],
      pricing: entry?.pricing ?? "paid",
      lastCheck: checks[`llm:${id}`] ?? null,
    });
  }
  for (const custom of settings.custom) {
    const id = `custom-${custom.slug}`;
    const provider = registry.get(id);
    rows.push({
      id, label: custom.label, kind: "custom",
      enabled: custom.enabled, ready: Boolean(provider),
      secret: store.describe(customSecretId(custom.slug)),
      baseUrl: custom.baseUrl, defaultModel: provider?.defaultModel ?? custom.defaultModel ?? null,
      embeddings: custom.embeddings ?? false,
      vision: custom.vision ?? null, cliPath: null, keyPageUrl: null, supportsLogin: false,
      howToVi: ["Nhập địa chỉ API (thường kết thúc bằng /v1).", "Dán key nếu nhà cung cấp yêu cầu."],
      pricing: "paid", lastCheck: checks[`llm:${id}`] ?? null,
    });
  }
  return rows;
}

function requireRow(deps: ConnectionRouteDeps, id: string): LlmConnectionRow {
  const row = llmRows(deps).find((entry) => entry.id === id);
  if (!row) throw new AppError(404, "PROVIDER_NOT_FOUND", "Không có nhà cung cấp này.");
  return row;
}

function dropUndefined(settings: LlmConnectionSettings): LlmConnectionSettings {
  return JSON.parse(JSON.stringify(settings)) as LlmConnectionSettings;
}

// ---------- Kiểm tra ----------

function now(): string {
  return new Date().toISOString();
}

function fail(message: string): ConnectionCheck {
  return { ok: false, message, checkedAt: now() };
}

/** Short Vietnamese message for an HTTP status. The key never appears in it. */
export function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return "Sai key";
  if (status === 429) return "Hết hạn mức";
  if (status === 404) return "Sai địa chỉ (không tìm thấy)";
  return `Nhà cung cấp trả lỗi ${status}`;
}

export function messageForError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const text = String(error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : error).toLowerCase();
  if (name === "AbortError" || name === "TimeoutError" || text.includes("timed out") || text.includes("timeout")) return "Hết thời gian chờ";
  return "Không kết nối được tới địa chỉ";
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await globalThis.fetch(url, { headers, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
  if (!response.ok) return { status: response.status, body: null };
  return { status: response.status, body: await response.json().catch(() => null) };
}

function countModels(body: unknown): number {
  const value = body as { data?: unknown; models?: unknown } | null;
  if (Array.isArray(value?.data)) return value.data.length;
  if (Array.isArray(value?.models)) return value.models.length;
  return 0;
}

async function testLlm(deps: ConnectionRouteDeps, id: string): Promise<ConnectionCheck> {
  const { config, store, registry } = deps;
  if (isCliId(id)) {
    // Never runs a real CLI from here: the check only says whether the app will call it.
    return registry.get(id)
      ? { ok: true, message: "CLI đã bật. App sẽ gọi khi cần.", checkedAt: now() }
      : fail("CLI đang tắt.");
  }
  const slug = customSlug(id);
  let baseUrl: string | null;
  let key: string | undefined;
  if (slug) {
    const custom = store.llmSettings().custom.find((entry) => entry.slug === slug);
    if (!custom) return fail("Không có nhà cung cấp này.");
    baseUrl = custom.baseUrl;
    key = store.resolve(customSecretId(slug));
  } else {
    baseUrl = baseUrlOf(config, id);
    const secretId = llmSecretId(id);
    key = secretId ? store.resolve(secretId) : undefined;
    if (secretId && !key && id !== "custom" && id !== "omniroute") return fail("Chưa có key.");
  }
  try {
    let result: { status: number; body: unknown };
    if (id === "anthropic") {
      result = await getJson("https://api.anthropic.com/v1/models?limit=1000", { "x-api-key": key!, "anthropic-version": "2023-06-01" });
    } else if (id === "gemini") {
      // The key goes in a header, never in the URL.
      result = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": key! });
    } else if (id === "remote-ollama") {
      if (!baseUrl) return fail("Chưa có địa chỉ.");
      result = await getJson(`${baseUrl.replace(/\/+$/, "")}/api/tags`, { authorization: `Bearer ${key}` });
    } else {
      if (!baseUrl) return fail("Chưa có địa chỉ.");
      result = await getJson(`${baseUrl.replace(/\/+$/, "")}/models`, key ? { authorization: `Bearer ${key}` } : {});
    }
    if (result.status >= 400) return fail(messageForStatus(result.status));
    const models = countModels(result.body);
    return { ok: true, message: models ? `Kết nối tốt, có ${models} model.` : "Kết nối tốt.", models, checkedAt: now() };
  } catch (error) {
    return fail(messageForError(error));
  }
}

async function testSecret(deps: ConnectionRouteDeps, row: SecretRow): Promise<ConnectionCheck> {
  if (row.kind === "platform") {
    return row.status.configured
      ? { ok: true, message: "Đã lưu. App kiểm tra thật khi bạn đăng nhập tài khoản.", checkedAt: now() }
      : fail("Chưa có thông tin ứng dụng.");
  }
  if (!row.status.configured && row.connectionId !== "openverse") return fail("Chưa có key.");
  const provider = row.connectionId === "brave"
    ? new BraveImageProvider(deps.config)
    : new ImageProviderRegistry(deps.config).get(row.connectionId);
  if (!provider) return fail("Nguồn này không kiểm tra được.");
  try {
    const results = await provider.search({ query: "mountain", perPage: 1, orientation: "landscape", signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    return { ok: true, message: results.length ? "Kết nối tốt, tìm thấy ảnh." : "Kết nối tốt (không có ảnh cho từ khoá thử).", checkedAt: now() };
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return fail(messageForStatus(status));
    return fail(messageForError(error));
  }
}

// ---------- Secret rows ----------

function platformAppIds(): StaticSecretId[] {
  return ["platform.youtube.app", "platform.tiktok.app", "platform.meta.app"];
}

function requireNonLlmSecret(id: string): StaticSecretId {
  if (!isStaticSecretId(id) || id.startsWith("llm.")) throw new AppError(400, "SECRET_UNKNOWN", "Không có loại key này.");
  return id;
}

function secretRows(deps: ConnectionRouteDeps): SecretRow[] {
  const checks = readChecks(deps.sqlite);
  const rows: SecretRow[] = [];
  for (const entry of CONNECTION_CATALOG) {
    if (entry.kind === "llm") continue;
    for (const id of entry.secrets) {
      rows.push({
        id,
        connectionId: entry.id,
        kind: entry.kind,
        label: entry.secrets.length > 1 ? `${entry.label} (${id.endsWith("Secret") ? "client secret" : "client id"})` : entry.label,
        keyPageUrl: entry.keyPageUrl,
        howToVi: entry.howToVi,
        status: deps.store.describe(id),
        lastCheck: checks[`secret:${entry.id}`] ?? null,
      });
    }
  }
  return rows;
}

function requireSecretRow(deps: ConnectionRouteDeps, id: string): SecretRow {
  const row = secretRows(deps).find((entry) => entry.id === id);
  if (!row) throw new AppError(400, "SECRET_UNKNOWN", "Không có loại key này.");
  return row;
}

function importableIds(store: SecretStore): string[] {
  return STATIC_SECRET_IDS.filter((id) => store.describe(id).source === "env");
}

// ---------- Overview ----------

function stateOf(input: { enabled: boolean; ready: boolean; lastCheck: ConnectionCheck | null }): ConnectionOverviewRow["state"] {
  if (!input.enabled) return "disabled";
  if (input.lastCheck && !input.lastCheck.ok) return "error";
  return input.ready ? "ready" : "needs_key";
}

function sourceOf(status: SecretStatus | null): ConnectionOverviewRow["source"] {
  return status ? status.source : null;
}

function overview(deps: ConnectionRouteDeps): ConnectionsOverview {
  const { sqlite, config, store, registry, tts } = deps;
  const ai = llmRows(deps)
    .filter((row) => row.kind !== "cli" || row.enabled)
    .map((row): ConnectionOverviewRow => {
      const state = stateOf(row);
      return {
        id: row.id,
        label: row.label,
        state,
        source: sourceOf(row.secret),
        detail: row.secret?.error === "UNREADABLE" ? "Không đọc được khóa đã lưu. Hãy nhập lại." : row.defaultModel,
        lastCheck: row.lastCheck,
        action: state === "ready" ? "test" : row.supportsLogin ? "login" : "key",
        href: `/settings/connections#provider-${row.id}`,
      };
    });

  const ttsProvider = tts.resolve();
  const voice: ConnectionOverviewRow[] = [{
    id: `tts-${ttsProvider.id}`,
    label: `Giọng đọc mặc định: ${ttsProvider.label}`,
    state: ttsProvider.isAvailable() ? "ready" : "needs_key",
    source: null,
    detail: null,
    lastCheck: null,
    action: "open",
    href: "/settings/tts",
  }];

  const imageStatus = getImageSourcesSettingsStatus(sqlite, config);
  const checks = readChecks(sqlite);
  const images: ConnectionOverviewRow[] = imageStatus.sources.map((source) => {
    const entry = connectionCatalogEntry(source.id);
    const secret = entry?.secrets[0] ? store.describe(entry.secrets[0]) : null;
    const lastCheck = checks[`secret:${source.id}`] ?? null;
    return {
      id: `image-${source.id}`,
      label: source.label,
      state: stateOf({ enabled: source.enabled, ready: !source.keyRequired || source.keyConfigured, lastCheck }),
      source: sourceOf(secret),
      detail: source.keyRequired ? null : "Không cần key",
      lastCheck,
      action: source.keyRequired && !source.keyConfigured ? "key" : "open",
      href: "/settings/image-sources",
    };
  });
  const brave = store.describe("web.brave.apiKey");
  const braveCheck = checks["secret:brave"] ?? null;
  images.push({
    id: "web-brave",
    label: "Brave Search (ảnh web)",
    state: stateOf({ enabled: true, ready: brave.configured, lastCheck: braveCheck }),
    source: brave.source,
    detail: null,
    lastCheck: braveCheck,
    action: brave.configured ? "test" : "key",
    href: "/settings/web-image",
  });

  const accountRows = listAllAccounts(deps);
  const accounts: ConnectionOverviewRow[] = accountRows.map((account) => ({
    id: `account-${account.id}`,
    label: `${account.displayName} (${account.profileName})`,
    state: !account.enabled ? "disabled"
      : account.connection === "CONNECTED" ? "ready"
        : account.connection === "NOT_CONNECTED" ? "needs_key" : "error",
    source: null,
    detail: account.platform,
    lastCheck: null,
    action: account.connection === "CONNECTED" ? "test" : "login",
    href: "/accounts",
  }));

  const telegramToken = deps.vault.hasSecret(TELEGRAM_BOT_TOKEN_KEY);
  const notifications: ConnectionOverviewRow[] = [{
    id: "telegram",
    label: "Telegram",
    state: telegramToken ? "ready" : "needs_key",
    source: telegramToken ? "app" : "none",
    detail: null,
    lastCheck: null,
    action: "open",
    href: "/settings/notifications",
  }];

  const items = [
    { id: "ai" as const, label: "Ít nhất một nhà cung cấp AI sẵn sàng", done: registry.list().some((provider) => provider.configured), href: "/settings/connections#ai" },
    { id: "voice" as const, label: "Có giọng đọc", done: ttsProvider.isAvailable(), href: "/settings/tts" },
    { id: "images" as const, label: "Có ít nhất một nguồn ảnh", done: imageStatus.sources.some((source) => source.enabled && (!source.keyRequired || source.keyConfigured)), href: "/settings/image-sources" },
    { id: "accounts" as const, label: "Kết nối ít nhất một tài khoản nền tảng", done: accountRows.some((account) => account.connection === "CONNECTED"), href: "/accounts" },
  ];
  return {
    sections: [
      { id: "ai", label: "AI", rows: ai },
      { id: "voice", label: "Giọng đọc", rows: voice },
      { id: "images", label: "Ảnh và video", rows: images },
      { id: "accounts", label: "Tài khoản nền tảng", rows: accounts },
      { id: "notifications", label: "Thông báo", rows: notifications },
    ],
    importable: importableIds(store),
    setup: { items, complete: items.every((item) => item.done), hidden: readSetting(sqlite, SETUP_HIDDEN_KEY) === true },
  };
}

// ---------- Accounts ----------

type AccountJoinRow = {
  id: string; profile_id: string; platform: string; display_name: string; handle: string | null;
  external_id: string | null; format: string; enabled: number; connection: string;
  connection_error: string | null; last_checked_at: string | null; publish_settings: string;
  created_at: string; updated_at: string; profile_name: string; market: string | null;
};

function listAllAccounts(deps: ConnectionRouteDeps, accountId?: string): AccountListRow[] {
  const rows = deps.sqlite.prepare(
    `SELECT a.id, a.profile_id, a.platform, a.display_name, a.handle, a.external_id, a.format, a.enabled,
            a.connection, a.connection_error, a.last_checked_at, a.publish_settings, a.created_at, a.updated_at,
            p.name AS profile_name, p.market
     FROM platform_accounts a JOIN profiles p ON p.id = a.profile_id
     WHERE ${scopeSql("p.workspace_id", "p.id").sql}${accountId ? " AND a.id = ?" : ""}
     ORDER BY p.name COLLATE NOCASE, a.created_at, a.id`,
  ).all(...scopeSql("p.workspace_id", "p.id").args, ...(accountId ? [accountId] : [])) as AccountJoinRow[];
  return rows.flatMap((row) => {
    const parsed = AccountListRowSchema.safeParse({
      id: row.id,
      profileId: row.profile_id,
      platform: row.platform,
      displayName: row.display_name,
      handle: row.handle,
      externalId: row.external_id,
      format: row.format,
      enabled: Boolean(row.enabled),
      connection: row.connection,
      connectionError: row.connection_error,
      lastCheckedAt: row.last_checked_at,
      publishSettings: safeJson(row.publish_settings),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      profileName: row.profile_name,
      tokenExpiresAt: deps.vault.getCredentialMeta(row.id)?.expiresAt ?? null,
    });
    if (!parsed.success) return [];
    const warning = marketAccountWarning(deps.sqlite, row.market, parsed.data.platform);
    return [warning ? { ...parsed.data, marketWarning: warning } : parsed.data];
  });
}

function requireAccountRow(deps: ConnectionRouteDeps, id: string): AccountListRow {
  const row = listAllAccounts(deps, id)[0];
  if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản.");
  return row;
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

// ---------- Developer apps ----------

function effectivePlatformApp(deps: ConnectionRouteDeps, platform: string, profileId?: string, accountId?: string) {
  const secretId = platformAppSecretId(platform);
  if (!secretId) return undefined;
  const account = accountId ? deps.publish.requireAccount(accountId) : undefined;
  if (account && (account.platform !== platform || (profileId && account.profile_id !== profileId))) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản trong phạm vi này.");
  }
  return deps.vault.loadAppCredentials(accountId ?? "", account?.profile_id ?? profileId ?? "", platform)
    ?? deps.store.resolveApp(secretId);
}

function platformAppStatus(deps: ConnectionRouteDeps, platform: string, profileId?: string, accountId?: string): PlatformAppStatus {
  const secretId = platformAppSecretId(platform);
  const effectiveProfileId = profileId ?? (secretId && accountId ? deps.publish.requireAccount(accountId).profile_id : undefined);
  const entry = connectionCatalogEntry(platform === "facebook_reels" || platform === "instagram_reels" ? "meta" : platform);
  const base = {
    platform,
    secretId,
    redirectUri: deps.publish.oauthRedirectUri(platform),
    consoleUrl: entry?.keyPageUrl ?? null,
    howToVi: entry?.howToVi ?? [],
    noteVi: entry?.noteVi,
    troubleshootVi: entry?.troubleshootVi ?? [],
    problems: (() => {
      const credentials = effectivePlatformApp(deps, platform, profileId, accountId);
      if (!credentials) return [];
      const errors = validatePlatformAppInput(platform, credentials).errors;
      return [...(errors.clientId ? [`Client ID đã lưu không đúng dạng. ${errors.clientId}`] : []),
        ...(errors.clientSecret ? [errors.clientSecret] : [])];
    })(),
  };
  if (!secretId) return { ...base, configured: platform === "mock", source: "none", hint: null };
  if (accountId) {
    const row = deps.sqlite.prepare("SELECT id_hint FROM platform_app_credentials WHERE account_id = ?").get(accountId) as
      | { id_hint: string | null } | undefined;
    if (row) return { ...base, configured: true, source: "account", hint: row.id_hint ? `…${row.id_hint}` : null };
  }
  if (effectiveProfileId) {
    const row = deps.sqlite.prepare(
      "SELECT id_hint FROM platform_app_credentials WHERE profile_id = ? AND platform = ? AND account_id IS NULL",
    ).get(effectiveProfileId, platform) as { id_hint: string | null } | undefined;
    if (row) return { ...base, configured: true, source: "profile", hint: row.id_hint ? `…${row.id_hint}` : null };
  }
  const status = deps.store.describe(secretId);
  if (status.configured) return { ...base, configured: true, source: status.source === "app" ? "app" : "env", hint: status.hint };
  return { ...base, configured: false, source: "none", hint: null };
}

// ---------- app_settings helpers ----------

function readSetting(sqlite: Database.Database, key: string): unknown {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

function writeSetting(sqlite: Database.Database, key: string, value: unknown): void {
  sqlite.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now());
}

function readChecks(sqlite: Database.Database): Record<string, ConnectionCheck> {
  const raw = readSetting(sqlite, CONNECTION_CHECKS_KEY);
  const parsed = z.record(z.string(), ConnectionCheckSchema).safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

function writeCheck(sqlite: Database.Database, key: string, check: ConnectionCheck): void {
  writeSetting(sqlite, CONNECTION_CHECKS_KEY, { ...readChecks(sqlite), [key]: check });
}

/** Read-only summary for the assistant / MCP tools: states and sources, never a secret. */
export function connectionsSummary(deps: ConnectionRouteDeps): ConnectionsOverview {
  return overview(deps);
}

export function platformAccountsSummary(deps: ConnectionRouteDeps): AccountListRow[] {
  return listAllAccounts(deps);
}
