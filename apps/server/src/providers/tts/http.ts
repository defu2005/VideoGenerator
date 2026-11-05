import { stripSecrets, type HttpRequest } from "@vg/shared";
import type { TtsContext } from "./context.js";

export async function sendHttp(
  ctx: TtsContext,
  request: HttpRequest,
  signal: AbortSignal | undefined,
  secrets: string[],
): Promise<{ bytes: Buffer; text: string; contentType: string }> {
  let response: Response;
  try {
    response = await ctx.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(stripSecrets(message, secrets));
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  if (!response.ok) throw new Error(stripSecrets(`TTS HTTP ${response.status} ${text.slice(0, 180)}`, secrets));
  return { bytes, text, contentType: response.headers.get("content-type") ?? "" };
}
