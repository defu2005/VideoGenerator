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
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
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
