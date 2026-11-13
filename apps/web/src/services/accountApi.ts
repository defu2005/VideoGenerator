import { ApiRequestError } from "./apiClient";

/** Account calls go straight to Better Auth (`/api/auth/*`); the plugin is installed only on the server. */
async function auth<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "include",
    headers: { Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const body = data as { message?: string; code?: string } | null;
    throw new ApiRequestError(response.status, body?.code ?? "HTTP_ERROR", authMessage(response.status, body?.code, body?.message));
  }
  return data as T;
}

export function authMessage(status: number, code?: string, message?: string): string {
  if (code === "INVALID_PASSWORD" || /invalid password/i.test(message ?? "")) return "Mật khẩu không đúng.";
  if (code === "INVALID_CODE" || /invalid (two factor )?code|invalid otp|invalid totp/i.test(message ?? "")) return "Mã không đúng hoặc đã hết hạn.";
  if (status === 401) return "Phiên đăng nhập đã hết hạn hoặc thông tin không đúng.";
  if (status === 429) return "Thử quá nhiều lần. Đợi một lúc rồi thử lại.";
  if (status === 403) return "Bạn không có quyền làm việc này.";
  return "Không thực hiện được. Thử lại sau.";
}

export type SessionRow = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: string; updatedAt?: string; expiresAt: string };
export type ApiKeyRow = { id: string; name: string | null; start?: string | null; prefix?: string | null; enabled?: boolean; createdAt: string; lastRequest?: string | null; expiresAt?: string | null };

export const changePassword = (currentPassword: string, newPassword: string) =>
  auth("/change-password", { body: { currentPassword, newPassword, revokeOtherSessions: true } });
export const updateName = (name: string) => auth("/update-user", { body: { name } });
export const listSessions = () => auth<SessionRow[]>("/list-sessions");
export const revokeSession = (token: string) => auth("/revoke-session", { body: { token } });
export const revokeOtherSessions = () => auth("/revoke-other-sessions", { body: {} });

export const enableTwoFactor = (password: string) =>
  auth<{ totpURI: string; backupCodes: string[] }>("/two-factor/enable", { body: { password } });
export const verifyTotp = (code: string) => auth("/two-factor/verify-totp", { body: { code } });
export const verifyBackupCode = (code: string) => auth("/two-factor/verify-backup-code", { body: { code } });
export const regenerateBackupCodes = (password: string) =>
  auth<{ backupCodes: string[] }>("/two-factor/generate-backup-codes", { body: { password } });
export const disableTwoFactor = (password: string) => auth("/two-factor/disable", { body: { password } });

export const listApiKeys = () =>
  auth<ApiKeyRow[] | { apiKeys: ApiKeyRow[] }>("/api-key/list").then((result) => (Array.isArray(result) ? result : result.apiKeys ?? []));
export const createApiKey = (name: string, expiresInDays: number | null) =>
  auth<{ key: string; id: string }>("/api-key/create", { body: { name, ...(expiresInDays ? { expiresIn: expiresInDays * 86400 } : {}) } });
export const deleteApiKey = (keyId: string) => auth("/api-key/delete", { body: { keyId } });

/** Reads the secret out of an otpauth:// URI so the person can type it into an authenticator without a QR code. */
export function secretFromUri(uri: string): string {
  try { return new URL(uri).searchParams.get("secret") ?? ""; } catch { return ""; }
}
