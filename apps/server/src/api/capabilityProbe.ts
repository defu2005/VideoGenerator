import { probeSawImage } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { recordAutomaticMediaCost } from "../operator/autonomyBudget.js";
import type { OmniRouteCatalogService } from "../providers/llm/omnirouteCatalog.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function registerCapabilityProbeRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  catalog: OmniRouteCatalogService,
): void {
  app.post("/api/llm/capabilities/probe", async (request) => {
    if (process.env.VITEST) {
      throw new AppError(409, "PROBE_DISABLED", "Không thử model khi đang chạy test.");
    }
    const { modelId } = z.object({ modelId: z.string().min(1).max(200) }).parse(request.body);
    const key = `capability.probe.${modelId}`;
    const cached = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (cached) {
      try {
        const parsed = JSON.parse(cached.value) as { vision?: boolean; at?: string };
        if (parsed.at && Date.now() - Date.parse(parsed.at) < WEEK_MS && typeof parsed.vision === "boolean") {
          return { modelId, vision: parsed.vision, source: "probe", cached: true };
        }
      } catch {
        // A broken cache row is probed again.
      }
    }
    if (!catalog.configured) {
      throw new AppError(503, "PROBE_UNAVAILABLE", "Chưa cấu hình OmniRoute nên chưa thử được khả năng model.");
    }
    const response = await fetch(new URL("chat/completions", `${catalog.baseUrl.replace(/\/+$/, "")}/`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Does this image contain a picture? Answer yes or no." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_1X1}` } },
          ],
        }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new AppError(502, "PROBE_FAILED", "Model không trả lời được ảnh thử.");
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const vision = probeSawImage(text);
    const at = new Date().toISOString();
    sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, JSON.stringify({ vision, at }), at);
    recordAutomaticMediaCost(sqlite, { amountUsd: 0.001, note: `Kiểm tra khả năng ${modelId}` });
    return { modelId, vision, source: "probe", cached: false };
  });
}
