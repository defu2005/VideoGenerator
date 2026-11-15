import { z } from "zod";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { edgeTtsVersion } from "../providers/tts/edgeTts.js";
import { registryCatalog, registryCatalogHash } from "../registry/catalog.js";

const McpHealthSchema = z.object({ up: z.boolean(), toolCount: z.number().int().nonnegative(), toolHash: z.string() });
export async function readMcpHealth(url?: string, fetchImpl: typeof fetch = fetch) {
  const expected = { up: false, toolCount: registryCatalog().length, toolHash: registryCatalogHash() };
  if (!url) return expected;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(2000), redirect: "error" });
    if (!response.ok) return expected;
    return McpHealthSchema.parse(await response.json());
  } catch { return expected; }
}

const HealthDetailsSchema = z.object({
  edgeTts: z.object({
    version: z.string(),
    path: z.string(),
    status: z.string(),
  }),
});

const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  db: z.literal("ok"),
  renderRunning: z.number().int().nonnegative(),
  renderConcurrency: z.number().int().positive(),
  render: z.string(),
  details: HealthDetailsSchema.optional(),
  mcp: McpHealthSchema.optional(),
});

export function renderActivityLabel(running: number, limit: number): string {
  return `render: ${running}/${limit} đang chạy`;
}

export function buildHealthReport(
  sqlite: InstanceType<typeof Database>,
  renderConcurrency: number,
  details?: z.infer<typeof HealthDetailsSchema>,
  mcp?: z.infer<typeof McpHealthSchema>,
) {
  sqlite.prepare("SELECT 1").get();
  const renderRunning = (sqlite.prepare(
    "SELECT COUNT(*) AS count FROM jobs WHERE stage = 'RENDER' AND status = 'RUNNING'",
  ).get() as { count: number }).count;
  return {
    status: "ok" as const,
    version: "0.1.0",
    db: "ok" as const,
    renderRunning,
    renderConcurrency,
    render: renderActivityLabel(renderRunning, renderConcurrency),
    ...(details ? { details } : {}),
    ...(mcp ? { mcp } : {}),
  };
}

export function registerHealthRoutes(
  app: FastifyInstance,
  sqlite: InstanceType<typeof Database>,
  renderConcurrency = 1,
  edgeTtsPath?: string,
  mcpHealthUrl?: string,
): void {
  app.get("/api/health", {
    schema: {
      response: { 200: HealthResponseSchema },
    },
  }, async () => {
    const [edgeTts, mcp] = await Promise.all([edgeTtsVersion(edgeTtsPath), readMcpHealth(mcpHealthUrl)]);
    return buildHealthReport(sqlite, renderConcurrency, {
      edgeTts: {
        version: edgeTts.version,
        path: edgeTts.path,
        status: edgeTts.status,
      },
    }, mcp);
  });
}
