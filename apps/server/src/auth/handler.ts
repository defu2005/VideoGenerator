import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requestIsHttps } from "./origins.js";
import type { VideoAgentAuth } from "./instance.js";

const SKIP_HEADERS = new Set(["set-cookie", "content-length", "transfer-encoding", "connection"]);

function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function withSecureCookie(cookie: string, secure: boolean): string {
  if (!secure || /;\s*secure\b/i.test(cookie)) return cookie;
  return `${cookie}; Secure`;
}

async function sendAuthResponse(request: FastifyRequest, reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.code(response.status);
  const secure = requestIsHttps(request);
  response.headers.forEach((value, key) => {
    if (SKIP_HEADERS.has(key.toLowerCase())) return;
    reply.header(key, value);
  });
  for (const cookie of response.headers.getSetCookie()) {
    reply.header("set-cookie", withSecureCookie(cookie, secure));
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength === 0) return reply.send();
  return reply.send(body);
}

export function registerAuthHandler(server: FastifyInstance, auth: VideoAgentAuth): void {
  server.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined && request.body !== null;
        const response = await auth.handler(new Request(url, {
          method: request.method,
          headers: toWebHeaders(request),
          body: hasBody ? JSON.stringify(request.body) : undefined,
        }));
        return await sendAuthResponse(request, reply, response);
      } catch {
        return reply.code(500).send({
          error: { code: "AUTH_ERROR", message: "Không xử lý được yêu cầu đăng nhập." },
        });
      }
    },
  });
}
