import { z } from "zod";

export const FleetFileSchema = z.object({
  path: z.string().min(1).max(240).refine((path) =>
    /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+\.(?:md|txt|json|yaml|yml|csv|tsv)$/.test(path)
    && !path.split("/").some((part) => part === ".." || part === "." || part.startsWith(".") || part.toLowerCase() === "auth.json"), "Đường dẫn gói không an toàn"),
  content: z.string().refine((text) => new TextEncoder().encode(text).length <= 256 * 1024, "File lớn hơn 256 KB"),
}).strict();
export const FleetSettingsSchema = z.object({
  provider: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/).default("vg-fleet"),
  model: z.string().trim().min(1).max(160).default("default"),
  baseUrl: z.string().url().refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }, "URL không được chứa thông tin đăng nhập").default("http://host.docker.internal:20128/v1"),
  hermesVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.-]+)?$/).default("0.23.1"),
  supervisionMinutes: z.number().int().min(1).max(60).default(15),
  autoActivateReadOnlySkills: z.boolean().default(false),
  memoryEnabled: z.boolean().default(true),
}).strict();
export type FleetSettings = z.infer<typeof FleetSettingsSchema>;
export const FleetCronSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/), schedule: z.string().min(1).max(60),
  prompt: z.string().min(1).max(300), skill: z.string().regex(/^[a-z0-9-]+$/), command: z.string().max(600),
}).strict();
// The sync agent accepts only the hub-owned configuration surface, never arbitrary YAML keys.
export const FleetConfigPatchSchema = z.object({
  model: z.object({ provider: z.string().max(60), default: z.string().max(160), base_url: z.string().url() }).strict(),
  providers: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/), z.object({ api: z.string().url(), api_mode: z.literal("chat_completions"), api_key: z.literal("${VG_HERMES_MODEL_KEY}") }).strict()),
  mcp_servers: z.object({ "video-agent": z.object({ url: z.literal("${VG_MCP_URL}"), headers: z.object({ Authorization: z.literal("Bearer ${VG_API_KEY}") }).strict() }).strict() }).strict(),
  skills: z.object({ external_dirs: z.array(z.literal("/opt/data/vg-skills")).length(1) }).strict(),
  memory: z.object({ memory_enabled: z.boolean() }).strict(),
}).strict();
export const FleetBundleSchema = z.object({
  bundleVersion: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(FleetFileSchema).max(300), configPatch: FleetConfigPatchSchema,
  hermesVersion: z.string().max(80), cron: z.array(FleetCronSchema).max(10), toolHash: z.string().regex(/^[a-f0-9]{64}$/),
  skillVersions: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/), z.number().int().positive()),
}).strict();
export type FleetBundle = z.infer<typeof FleetBundleSchema>;

/** Fixed field order used by both the hub and sidecar to verify a bundle's sha256. */
export function fleetBundlePayload(bundle: Omit<FleetBundle, "bundleVersion" | "hash">): string {
  return JSON.stringify({ files: bundle.files, configPatch: bundle.configPatch, hermesVersion: bundle.hermesVersion, cron: bundle.cron, toolHash: bundle.toolHash, skillVersions: bundle.skillVersions });
}
