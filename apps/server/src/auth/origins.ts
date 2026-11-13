import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../lib/config.js";

const LOCAL_ORIGINS = [
  "http://localhost:5180",
  "http://127.0.0.1:5180",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

export function trustedOrigins(config: AppConfig): string[] {
  const extra = (config.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set([...LOCAL_ORIGINS, config.CORS_ORIGIN, config.WEB_BASE_URL, ...extra])];
}

export function requestIsHttps(request: FastifyRequest): boolean {
  if (request.protocol === "https") return true;
  const forwarded = request.headers["x-forwarded-proto"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim().toLowerCase() === "https";
}
