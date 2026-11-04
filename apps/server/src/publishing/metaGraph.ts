import {
  META_GRAPH_VERSION,
  META_OAUTH_SCOPES,
  META_SCOPES,
  type MetaTargetWithToken,
  type PlatformId,
  type TokenSet,
} from "@vg/shared";

export type { MetaTargetWithToken };
import type { AppConfig } from "../lib/config.js";
import type { TokenVault } from "./tokenVault.js";

export type MetaFetch = typeof fetch;

export const META_AUTH_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const META_RUPLOAD_VIDEO = `https://rupload.facebook.com/video-upload/${META_GRAPH_VERSION}`;
export const META_RUPLOAD_IG = `https://rupload.facebook.com/ig-api-upload/${META_GRAPH_VERSION}`;

const LONG_LIVED_SECONDS = 60 * 24 * 60 * 60; // ~60 days

export type MetaCredentials = { appId: string; appSecret: string };

export type MetaGraphDeps = {
  config: AppConfig;
  vault: TokenVault;
  sqlite: import("better-sqlite3").Database;
  fetchImpl?: MetaFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export function isMetaPlatform(platform: PlatformId): platform is "facebook_reels" | "instagram_reels" {
  return platform === "facebook_reels" || platform === "instagram_reels";
}

export function resolveMetaCredentials(
  deps: Pick<MetaGraphDeps, "config" | "vault" | "sqlite">,
  accountId: string,
): MetaCredentials {
  const row = deps.sqlite.prepare(
    "SELECT profile_id, platform FROM platform_accounts WHERE id = ?",
  ).get(accountId) as { profile_id: string; platform: string } | undefined;
  if (!row) {
    throw Object.assign(new Error("Không tìm thấy tài khoản"), { status: 404, retryable: false });
  }
  const fromVault = deps.vault.loadAppCredentials(accountId, row.profile_id, row.platform);
  if (fromVault?.clientId && fromVault.clientSecret) {
    return { appId: fromVault.clientId, appSecret: fromVault.clientSecret };
  }
  const appId = deps.config.META_APP_ID?.trim();
  const appSecret = deps.config.META_APP_SECRET?.trim();
  if (appId && appSecret) {
    return { appId, appSecret };
  }
  throw Object.assign(new Error("Chưa cấu hình App ID/App Secret cho Meta"), {
    status: 400,
    retryable: false,
    code: "META_CREDENTIALS_MISSING",
  });
}

export function buildMetaAuthUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(META_AUTH_DIALOG);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_OAUTH_SCOPES);
  return url.toString();
}

export async function exchangeMetaCode(input: {
  code: string;
  redirectUri: string;
  appId: string;
  appSecret: string;
  fetchImpl: MetaFetch;
  signal: AbortSignal;
}): Promise<TokenSet> {
  const shortLived = await exchangeToken({
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    params: {
      client_id: input.appId,
      client_secret: input.appSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    },
  });
  return exchangeLongLivedUserToken({
    shortLivedToken: shortLived.accessToken,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    scopes: shortLived.scopes.length ? shortLived.scopes : [...META_SCOPES],
  });
}

export async function exchangeLongLivedUserToken(input: {
  shortLivedToken: string;
  appId: string;
  appSecret: string;
  fetchImpl: MetaFetch;
  signal: AbortSignal;
  scopes: string[];
}): Promise<TokenSet> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("fb_exchange_token", input.shortLivedToken);
  const response = await input.fetchImpl(url.toString(), { signal: input.signal });
  if (!response.ok) {
    throw mapMetaGraphError(await safeJson(response), response.status);
  }
  const data = await response.json() as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!data.access_token) {
    throw Object.assign(new Error("Phản hồi token Meta không hợp lệ"), {
      status: 502,
      retryable: true,
    });
  }
  const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0
    ? data.expires_in
    : LONG_LIVED_SECONDS;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: input.scopes,
    ...(data.token_type ? { tokenType: data.token_type } : { tokenType: "Bearer" }),
  };
}

/** Refresh a still-valid long-lived user token (Meta has no classic refresh_token). */
export async function refreshLongLivedUserToken(input: {
  tokens: TokenSet;
  appId: string;
  appSecret: string;
  fetchImpl: MetaFetch;
  signal: AbortSignal;
}): Promise<TokenSet> {
  return exchangeLongLivedUserToken({
    shortLivedToken: input.tokens.accessToken,
    appId: input.appId,
    appSecret: input.appSecret,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    scopes: input.tokens.scopes.length ? input.tokens.scopes : [...META_SCOPES],
  });
}

export async function discoverMetaTargets(input: {
  userAccessToken: string;
  platform: "facebook_reels" | "instagram_reels";
  fetchImpl: MetaFetch;
  signal: AbortSignal;
}): Promise<MetaTargetWithToken[]> {
  const url = new URL(`${META_GRAPH_BASE}/me/accounts`);
  url.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,username,name}",
  );
  url.searchParams.set("access_token", input.userAccessToken);
  const response = await input.fetchImpl(url.toString(), { signal: input.signal });
  if (!response.ok) {
    throw mapMetaGraphError(await safeJson(response), response.status);
  }
  const data = await response.json() as {
    data?: Array<{
      id?: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; username?: string; name?: string };
    }>;
  };
  const pages = data.data ?? [];
  const targets: MetaTargetWithToken[] = [];

  if (input.platform === "facebook_reels") {
    for (const page of pages) {
      if (!page.id || !page.access_token) continue;
      targets.push({
        id: page.id,
        name: page.name?.trim() || `Page ${page.id}`,
        kind: "page",
        pageAccessToken: page.access_token,
      });
    }
  } else {
    for (const page of pages) {
      const ig = page.instagram_business_account;
      if (!page.id || !page.access_token || !ig?.id) continue;
      const username = ig.username?.trim();
      targets.push({
        id: ig.id,
        name: ig.name?.trim() || username || `Instagram ${ig.id}`,
        ...(username ? { handle: username.startsWith("@") ? username : `@${username}` } : {}),
        kind: "instagram",
        pageId: page.id,
        pageAccessToken: page.access_token,
      });
    }
  }

  return targets;
}

export async function fetchMetaUserLabel(
  accessToken: string,
  fetchImpl: MetaFetch,
  signal: AbortSignal,
): Promise<{ displayName: string; externalId: string }> {
  const url = new URL(`${META_GRAPH_BASE}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);
  const response = await fetchImpl(url.toString(), { signal });
  if (!response.ok) {
    throw mapMetaGraphError(await safeJson(response), response.status);
  }
  const data = await response.json() as { id?: string; name?: string };
  if (!data.id) {
    throw Object.assign(new Error("Không tìm thấy hồ sơ Meta"), {
      status: 404,
      retryable: false,
    });
  }
  return {
    displayName: data.name?.trim() || "Meta",
    externalId: data.id,
  };
}

export async function fetchPageIdentity(
  pageId: string,
  pageAccessToken: string,
  fetchImpl: MetaFetch,
  signal: AbortSignal,
): Promise<{ displayName: string; externalId: string }> {
  const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(pageId)}`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", pageAccessToken);
  const response = await fetchImpl(url.toString(), { signal });
  if (!response.ok) {
    throw mapMetaGraphError(await safeJson(response), response.status);
  }
  const data = await response.json() as { id?: string; name?: string };
  if (!data.id) {
    throw Object.assign(new Error("Không tìm thấy Facebook Page"), {
      status: 404,
      retryable: false,
    });
  }
  return {
    displayName: data.name?.trim() || `Page ${data.id}`,
    externalId: data.id,
  };
}

export async function fetchIgIdentity(
  igUserId: string,
  accessToken: string,
  fetchImpl: MetaFetch,
  signal: AbortSignal,
): Promise<{ displayName: string; handle?: string; externalId: string }> {
  const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(igUserId)}`);
  url.searchParams.set("fields", "id,username,name");
  url.searchParams.set("access_token", accessToken);
  const response = await fetchImpl(url.toString(), { signal });
  if (!response.ok) {
    throw mapMetaGraphError(await safeJson(response), response.status);
  }
  const data = await response.json() as { id?: string; username?: string; name?: string };
  if (!data.id) {
    throw Object.assign(new Error("Không tìm thấy tài khoản Instagram"), {
      status: 404,
      retryable: false,
    });
  }
  const username = data.username?.trim();
  return {
    displayName: data.name?.trim() || username || `Instagram ${data.id}`,
    ...(username ? { handle: username.startsWith("@") ? username : `@${username}` } : {}),
    externalId: data.id,
  };
}

export async function metaFetchWithRetry(
  fetchImpl: MetaFetch,
  sleep: (ms: number) => Promise<void>,
  url: string,
  init: RequestInit,
  maxAttempts = 4,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (attempt >= maxAttempts || init.signal?.aborted) throw error;
      await sleep(250 * attempt);
      continue;
    }
    const bodyPreview = response.status === 400 || response.status === 403 || response.status === 429
      ? await response.clone().json().catch(() => null)
      : null;
    const graphCode = extractGraphCode(bodyPreview);

    if ((response.status === 429 || isRateLimitCode(graphCode) || response.status >= 500)
      && attempt < maxAttempts
    ) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * attempt;
      await sleep(waitMs);
      continue;
    }
    return response;
  }
}

export function mapMetaGraphError(body: unknown, status: number): Error {
  const code = extractGraphCode(body);
  const message = extractGraphMessage(body);

  if (code === 190 || status === 401) {
    return Object.assign(new Error("Cần kết nối lại tài khoản Meta"), {
      status: 401,
      retryable: false,
      code: "invalidCredentials",
    });
  }
  if (code === 10 || code === 200 || status === 403) {
    return Object.assign(
      new Error(message ?? "Thiếu quyền Meta (Page/Instagram). Kết nối lại và chọn đúng tài khoản."),
      { status: 403, retryable: false, code: String(code ?? "permission") },
    );
  }
  if (isRateLimitCode(code) || status === 429) {
    return Object.assign(new Error("Meta giới hạn tốc độ. Thử lại sau."), {
      status: 429,
      retryable: true,
      code: String(code ?? "rate_limit"),
    });
  }
  return Object.assign(new Error(message ?? `Lỗi Meta Graph API (HTTP ${status})`), {
    status,
    retryable: status === 429 || status >= 500,
    code: code != null ? String(code) : "meta_error",
  });
}

export function buildMetaCaption(title: string, description: string, tags: string[]): string {
  const hashtags = tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  const parts = [title.trim(), description.trim(), hashtags.join(" ")].filter(Boolean);
  return parts.join("\n\n");
}

export function trimCaption(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

async function exchangeToken(input: {
  fetchImpl: MetaFetch;
  signal: AbortSignal;
  params: Record<string, string>;
}): Promise<TokenSet> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  for (const [key, value] of Object.entries(input.params)) {
    url.searchParams.set(key, value);
  }
  const response = await input.fetchImpl(url.toString(), { signal: input.signal });
  if (!response.ok) {
    throw mapMetaGraphError(await safeJson(response), response.status);
  }
  const data = await response.json() as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!data.access_token) {
    throw Object.assign(new Error("Phản hồi token Meta không hợp lệ"), {
      status: 502,
      retryable: true,
    });
  }
  return {
    accessToken: data.access_token,
    ...(typeof data.expires_in === "number"
      ? { expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() }
      : {}),
    scopes: [...META_SCOPES],
    ...(data.token_type ? { tokenType: data.token_type } : { tokenType: "Bearer" }),
  };
}

function isRateLimitCode(code: number | undefined): boolean {
  return code === 4 || code === 17 || code === 32 || code === 613;
}

function extractGraphCode(body: unknown): number | undefined {
  const err = body as { error?: { code?: number } } | null;
  return typeof err?.error?.code === "number" ? err.error.code : undefined;
}

function extractGraphMessage(body: unknown): string | undefined {
  const err = body as { error?: { message?: string; error_user_msg?: string } } | null;
  return err?.error?.error_user_msg ?? err?.error?.message;
}

export async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
