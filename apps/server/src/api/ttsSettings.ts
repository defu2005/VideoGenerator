import { createReadStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { TtsAppSettingsInputSchema, TtsPreviewInputSchema, TtsSecretInputSchema, audioExtensionFor } from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import type { TtsProviderRegistry } from "../providers/tts/registry.js";
import { touchFromOwner } from "../operator/autopilot.js";
import { describeTtsProviders, readTtsSettings, saveTtsSettings, ttsSecretKey } from "../settings/tts.js";

const SampleParams = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const SAMPLE_TEXT = "Xin chào, đây là giọng đọc thử.";

export function registerTtsSettingsRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  config: AppConfig,
  vault: TokenVault,
  registry: TtsProviderRegistry,
): void {
  app.get("/api/settings/tts", async () => {
    const settings = readTtsSettings(sqlite, config.TTS_PROVIDER);
    const subscription = await registry.elevenSubscription();
    return {
      settings,
      providers: describeTtsProviders({
        settings,
        configured: (id) => registry.configured(id),
        subscription,
      }),
    };
  });

  app.put("/api/settings/tts", async (request) => {
    const patch = TtsAppSettingsInputSchema.parse(request.body ?? {});
    touchFromOwner(request.headers, sqlite, "tts:settings");
    const settings = saveTtsSettings(sqlite, config.TTS_PROVIDER, patch);
    return {
      settings,
      providers: describeTtsProviders({
        settings,
        configured: (id) => registry.configured(id),
      }),
    };
  });

  app.put("/api/settings/tts/secret", async (request) => {
    const body = TtsSecretInputSchema.parse(request.body ?? {});
    const key = ttsSecretKey(body.provider);
    if (!body.apiKey.trim()) vault.deleteSecret(key);
    else vault.storeSecret(key, body.apiKey.trim());
    return { provider: body.provider, configured: vault.hasSecret(key) };
  });

  app.post("/api/settings/tts/preview", async (request) => {
    const body = TtsPreviewInputSchema.parse(request.body ?? {});
    const rate = body.rate ?? readTtsSettings(sqlite, config.TTS_PROVIDER).defaultRate;
    const text = body.text.trim() || SAMPLE_TEXT;
    const sample = registry.samplePath(body.provider, body.voice, text, rate);
    if (registry.findSample(sample.hash)) {
      return {
        url: `/api/settings/tts/samples/${sample.hash}`,
        timingSource: "estimated" as const,
        providerId: body.provider,
        characters: text.length,
        cached: true,
      };
    }
    mkdirSync(join(config.DATA_DIR, "tts-samples"), { recursive: true });
    const spoken = await registry.synthesizePreview({
      providerId: body.provider,
      voice: body.voice,
      text,
      rate,
      style: body.style,
      outPath: sample.path,
      language: "vi",
    });
    return {
      url: `/api/settings/tts/samples/${sample.hash}`,
      timingSource: spoken.timingSource,
      providerId: spoken.providerId,
      characters: spoken.characters,
      cached: false,
    };
  });

  app.get("/api/settings/tts/samples/:hash", async (request, reply) => {
    const { hash } = SampleParams.parse(request.params);
    const path = registry.findSample(hash);
    if (!path) return reply.code(404).send({ error: { code: "SAMPLE_NOT_FOUND", message: "Không thấy mẫu giọng." } });
    const extension = path.split(".").at(-1) ?? audioExtensionFor("edge-tts");
    reply.header("Content-Type", extension === "wav" ? "audio/wav" : "audio/mpeg");
    reply.header("Cache-Control", "private, max-age=86400");
    return reply.send(createReadStream(path));
  });
}
