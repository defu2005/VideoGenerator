import { ApiErrorSchema } from "@vg/shared";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const API_BASE_URL = "/api";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (typeof options.body === "string") headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, credentials: "include" });
  if (response.status === 401 && shouldRedirectToLogin(path)) redirectToLogin();
  if (response.status === 204) return undefined as T;

  const responseText = await response.text();
  let responseBody: unknown;
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText) as unknown;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      if (!response.ok) {
        throw new ApiRequestError(response.status, "HTTP_ERROR", response.statusText || "Request failed");
      }
      throw new ApiRequestError(response.status, "INVALID_RESPONSE", "The server returned invalid JSON");
    }
  }

  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(responseBody);
    if (parsedError.success) {
      const { code, message, details } = parsedError.data.error;
      announceAccessProblem(response.status, code, message);
      throw new ApiRequestError(response.status, code, message, details);
    }
    throw new ApiRequestError(
      response.status,
      "HTTP_ERROR",
      response.statusText || "Request failed",
      responseBody,
    );
  }

  return responseBody as T;
}

function announceAccessProblem(status: number, code: string, message: string): void {
  if (typeof window === "undefined") return;
  if (status === 409 && code === "WORKSPACE_REQUIRED") {
    window.dispatchEvent(new CustomEvent("vg:workspace-required"));
  } else if (status === 403) {
    window.dispatchEvent(new CustomEvent("vg:forbidden", { detail: message }));
  }
}

function shouldRedirectToLogin(path: string): boolean {
  if (path.startsWith("/auth/") || path.startsWith("/setup")) return false;
  if (typeof window === "undefined") return false;
  return window.location.pathname !== "/login" && window.location.pathname !== "/setup";
}

function redirectToLogin(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export type SessionUser = { id: string; name: string };

export async function fetchSessionUser(): Promise<SessionUser | null> {
  const response = await fetch("/api/auth/get-session", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  try {
    const body = await response.json() as { user?: { id?: string; name?: string } } | null;
    if (!body?.user?.id || !body.user.name) return null;
    return { id: body.user.id, name: body.user.name };
  } catch {
    return null;
  }
}

/** Resolves with `twoFactor: true` when the password was right but a second step is still needed. */
export async function signIn(email: string, password: string): Promise<{ twoFactor: boolean }> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    throw new ApiRequestError(response.status, body?.code ?? "UNAUTHORIZED", signInErrorMessage(response.status, body?.code));
  }
  const result = await response.json().catch(() => null) as { twoFactorRedirect?: boolean } | null;
  return { twoFactor: result?.twoFactorRedirect === true };
}

/** Only a 401 means a wrong email/password; other failures must not be reported as one. */
export function signInErrorMessage(status: number, code?: string): string {
  if (status === 401) return "Email hoặc mật khẩu không đúng.";
  if (code === "INVALID_ORIGIN" || status === 403) {
    return `Server không chấp nhận địa chỉ trang này (${window.location.origin}). Mở app ở http://localhost:5173 hoặc thêm địa chỉ vào AUTH_TRUSTED_ORIGINS.`;
  }
  if (status === 429) return "Thử đăng nhập quá nhiều lần. Đợi một lúc rồi thử lại.";
  return `Không đăng nhập được (lỗi ${status}). Kiểm tra server API có đang chạy không.`;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  window.location.assign("/login");
}

export async function setupStatus(): Promise<{ userExists: boolean }> {
  const response = await fetch("/api/setup/status", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new ApiRequestError(response.status, "HTTP_ERROR", "Không đọc được trạng thái thiết lập.");
  return await response.json() as { userExists: boolean };
}

export async function createOwner(input: { name: string; email: string; password: string; setupCode?: string }): Promise<void> {
  const response = await fetch("/api/setup/owner", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.ok) return;
  let message = "Không tạo được tài khoản. Kiểm tra tên, email và mật khẩu (ít nhất 8 ký tự).";
  try {
    const body = await response.json() as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the generic message.
  }
  throw new ApiRequestError(response.status, "SETUP_FAILED", message);
}

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login") || value.startsWith("/setup")) return "/";
  return value;
}
