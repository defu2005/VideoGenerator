import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { FleetBundleSchema, FleetFileSchema, FleetSettingsSchema, fleetBundlePayload, redactExportText, type FleetBundle, type FleetSettings } from "@vg/shared";
import { z } from "zod";
import { currentWorkspaceId } from "../auth/requestContext.js";
import { defaultWorkspaceId } from "../auth/workspaces.js";
import { AppError } from "../lib/errors.js";
import { ASSISTANT_TOOLS } from "../assistant/tools.js";
import { registryCatalog, registryCatalogHash } from "../registry/catalog.js";
import { renderHandbook, renderSharedLessonData } from "../operator/handbook.js";
import { loadRepoSkills } from "../operator/repoSkills.js";
import { OPERATOR_SKILLS, parseSkillMarkdown } from "../operator/skills.js";
import { activateSkillVersion, listSkillVersions, saveSkillDraft, type SkillRegistry } from "../operator/skillVersions.js";
import { SKILL_EVAL_MIN_SCORE } from "../operator/skillEval.js";
import { repoRoot } from "../operator/workspace.js";
import { touchInstance } from "../supervision/duty.js";
import type { TrustedAgent } from "../supervision/identity.js";
import { lessonsDigest } from "./lessons.js";

const settingKey = "fleet.settings";
function read(db: Database.Database, key: string): string | undefined { return (db.prepare("SELECT value FROM app_settings WHERE key=?").get(key) as { value: string } | undefined)?.value; }
function write(db: Database.Database, key: string, value: string, now = new Date()) {
  db.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, value, now.toISOString());
}
export const fleetSettings = (db: Database.Database): FleetSettings => FleetSettingsSchema.parse(JSON.parse(read(db, settingKey) ?? "{}"));
export function saveFleetSettings(db: Database.Database, input: unknown) { const settings = FleetSettingsSchema.parse(input); write(db, settingKey, JSON.stringify(settings)); return settings; }
const skillRegistry = (): SkillRegistry => new Map(Object.values(ASSISTANT_TOOLS).map((tool) => [tool.name, tool.risk]));

export function buildFleetBundle(db: Database.Database, options: { root?: string; secretValues?: readonly string[]; now?: Date } = {}): FleetBundle {
  const now = options.now ?? new Date();
  const settings = fleetSettings(db);
  const active = listSkillVersions(db, true);
  const repo = loadRepoSkills({ root: options.root ?? repoRoot(), toolNames: new Set(Object.keys(ASSISTANT_TOOLS)), builtinNames: new Set(OPERATOR_SKILLS.map((s) => s.name)), userNames: new Set(active.map((s) => s.name)) }).skills;
  const fileMap = new Map<string, string>();
  for (const skill of repo) fileMap.set(`${skill.name}/SKILL.md`, skill.markdown);
  for (const skill of active) {
    fileMap.set(`${skill.name}/SKILL.md`, skill.markdown);
    for (const [path, content] of Object.entries(skill.evidence.files ?? {})) {
      const file = FleetFileSchema.parse({ path: `${skill.name}/${path}`, content }); fileMap.set(file.path, file.content);
    }
  }
  const handbook = renderHandbook({ tools: registryCatalog(), skills: [...OPERATOR_SKILLS, ...repo], duties: [], snapshot: "Đọc trạng thái hiện tại qua get_agent_context; không dùng trạng thái đã lưu để quyết định thao tác." });
  // Standing orders are workspace-specific and included without runtime or credential settings.
  const orders = db.prepare("SELECT title,prompt FROM standing_orders WHERE workspace_id IS ? AND enabled=1 ORDER BY id").all(currentWorkspaceId(db)) as Array<{ title: string; prompt: string }>;
  fileMap.set("vg-handbook/SKILL.md", `---\nname: vg-handbook\ndescription: Sổ tay và giới hạn vận hành Video Agent.\n---\n\n${handbook}\n\n## Lệnh thường trực\n${orders.map((o) => `- ${o.title}: ${o.prompt}`).join("\n")}\n`);
  fileMap.set("vg-fleet-lessons/SKILL.md", `---\nname: vg-fleet-lessons\ndescription: Bài học vận hành dùng chung có bằng chứng.\n---\n\n${renderSharedLessonData(lessonsDigest(db))}`);
  const files = [...fileMap].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => FleetFileSchema.parse({ path, content: redactExportText(content) }));
  const interval = settings.supervisionMinutes;
  const schedule = `every ${interval}m`;
  const payload: Omit<FleetBundle, "bundleVersion" | "hash"> = {
    files,
    configPatch: {
      model: { provider: `custom:${settings.provider}`, default: settings.model, base_url: settings.baseUrl },
      providers: { [settings.provider]: { api: settings.baseUrl, api_mode: "chat_completions", api_key: "${VG_HERMES_MODEL_KEY}" } },
      mcp_servers: { "video-agent": { url: "${VG_MCP_URL}", headers: { Authorization: "Bearer ${VG_API_KEY}" } } },
      skills: { external_dirs: ["/opt/data/vg-skills"] }, memory: { memory_enabled: settings.memoryEnabled },
    },
    hermesVersion: settings.hermesVersion,
    cron: [{ name: "vg-supervise", schedule, prompt: "Run the vg-supervise skill", skill: "vg-supervise", command: `hermes cron create "${schedule}" "Run the vg-supervise skill" --skill vg-supervise --name vg-supervise` }],
    toolHash: registryCatalogHash(),
    skillVersions: Object.fromEntries(active.map((skill) => [skill.name, skill.version])),
  };
  const serialized = fleetBundlePayload(payload);
  const secretSettings = db.prepare("SELECT value FROM app_settings WHERE lower(key) LIKE '%secret%' OR lower(key) LIKE '%token%' OR lower(key) LIKE '%api_key%'").all() as Array<{ value: string }>;
  if ([...(options.secretValues ?? []), ...secretSettings.map((s) => s.value)].some((secret) => secret.length >= 8 && serialized.includes(secret))) throw new AppError(500, "FLEET_SECRET_REJECTED", "Gói chứa giá trị bí mật; đã từ chối xuất.");
  const hash = createHash("sha256").update(serialized).digest("hex");
  return db.transaction(() => {
    const key = `fleet.bundle.${currentWorkspaceId(db) ?? "default"}`;
    const prior = JSON.parse(read(db, key) ?? "null") as { version: number; hash: string } | null;
    const version = prior?.hash === hash ? prior.version : (prior?.version ?? 0) + 1;
    const bundle = FleetBundleSchema.parse({ ...payload, bundleVersion: version, hash });
    if (prior?.hash !== hash) write(db, key, JSON.stringify({ version, hash, changedAt: now.toISOString() }), now);
    return bundle;
  }).immediate();
}

export const FleetHeartbeatSchema = z.object({
  instance: z.string().max(80).optional(), environment: z.string().max(80), host: z.string().max(120).optional(),
  hermesVersion: z.string().max(80), bundleVersion: z.number().int().nonnegative(), skillsHash: z.string().max(64), toolHash: z.string().max(64),
  lastError: z.string().max(500).nullable().optional(), pendingCron: z.array(z.string().max(600)).max(10).default([]),
}).strict();
export function fleetHeartbeat(db: Database.Database, agent: TrustedAgent, raw: unknown, now = new Date()) {
  const input = FleetHeartbeatSchema.parse(raw);
  if (input.instance && input.instance !== agent.instance && input.instance !== agent.name) throw new AppError(403, "FLEET_IDENTITY_MISMATCH", "Instance phải khớp danh tính trên khóa máy.");
  const bundle = buildFleetBundle(db, { now });
  touchInstance(db, { ...agent, environment: input.environment }, { now, workspaceId: currentWorkspaceId(db) });
  db.prepare(`UPDATE agent_instances SET host=?, hermes_version=?, bundle_version=?, skills_hash=?, tool_hash=?, last_sync_at=?, last_error=?, pending_cron=?,
    bundle_behind_since=CASE WHEN ? >= ? THEN NULL ELSE COALESCE(bundle_behind_since,?) END WHERE instance=?`)
    .run(input.host ?? null, input.hermesVersion, input.bundleVersion, input.skillsHash, input.toolHash, now.toISOString(), input.lastError ? redactExportText(input.lastError) : null, JSON.stringify(input.pendingCron), input.bundleVersion, bundle.bundleVersion, now.toISOString(), agent.instance);
  return { ok: true, bundleVersion: bundle.bundleVersion, toolHash: bundle.toolHash };
}
export type FleetAnomaly = { kind: string; severity: "warn" | "high"; ref: string; detail: string };
export function fleetOverview(db: Database.Database, now = new Date()) {
  const settings = fleetSettings(db);
  const bundle = buildFleetBundle(db, { now });
  const bundleState = JSON.parse(read(db, `fleet.bundle.${currentWorkspaceId(db) ?? "default"}`) ?? "{}") as { changedAt?: string };
  const instances = db.prepare("SELECT instance,environment,host,hermes_version AS hermesVersion,bundle_version AS bundleVersion,skills_hash AS skillsHash,tool_hash AS toolHash,last_sync_at AS lastSyncAt,last_error AS lastError,pending_cron AS pendingCron,bundle_behind_since AS behindSince,last_seen_at AS lastSeenAt FROM agent_instances WHERE kind='hermes' ORDER BY instance").all() as Array<{ instance: string; environment: string; host: string | null; hermesVersion: string | null; bundleVersion: number; skillsHash: string | null; toolHash: string | null; lastSyncAt: string | null; lastError: string | null; pendingCron: string; behindSince: string | null; lastSeenAt: string }>;
  const anomalies: FleetAnomaly[] = [];
  const workspace = currentWorkspaceId(db);
  const items = instances.filter((row) => {
    const recorded = read(db, `fleet.instanceWorkspace.${row.instance}`);
    return (recorded ? JSON.parse(recorded) as string : defaultWorkspaceId(db)) === workspace;
  }).map((row) => {
    const issues: FleetAnomaly[] = [];
    const add = (kind: string, detail: string, severity: "warn" | "high" = "warn") => issues.push({ kind, severity, ref: row.instance, detail });
    if (!row.lastSyncAt || now.getTime() - Date.parse(row.lastSyncAt) > 15 * 60_000) add("fleet_offline", "Chạy lại vg-hermes-sync và kiểm tra kết nối hub.", "high");
    const behindSince = row.behindSince ?? bundleState.changedAt;
    if (row.bundleVersion < bundle.bundleVersion && behindSince && now.getTime() - Date.parse(behindSince) > 15 * 60_000) add("fleet_bundle_behind", "Chạy vg-hermes-sync để kéo gói mới.");
    if (row.hermesVersion !== settings.hermesVersion) add("fleet_version_drift", `Đổi image tag thành ${settings.hermesVersion}, pull rồi khởi động lại gateway.`);
    if (row.toolHash !== bundle.toolHash) add("fleet_tool_drift", "Cập nhật MCP của hub, chạy vg-hermes-sync rồi /reload-mcp.");
    const pendingCron = JSON.parse(row.pendingCron) as string[];
    for (const command of pendingCron) add("fleet_missing_cron", `Chạy lệnh: ${command}`);
    anomalies.push(...issues);
    return { ...row, pendingCron, issues };
  });
  return { settings, bundleVersion: bundle.bundleVersion, hash: bundle.hash, toolHash: bundle.toolHash, instances: items, anomalies };
}
export const FleetDraftSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/), markdown: z.string().min(1).max(12_000),
  files: z.record(z.string(), z.string()).default({}), instance: z.string().max(80).optional(), parentVersion: z.number().int().positive().optional(),
  evidence: z.object({ reason: z.string().min(1).max(1000), runIds: z.array(z.string().max(80)).max(20).default([]) }).strict(),
}).strict();
export function saveFleetDraft(db: Database.Database, agent: TrustedAgent, raw: unknown) {
  const input = FleetDraftSchema.parse(raw);
  if (parseSkillMarkdown(input.markdown)?.name !== input.name) throw new AppError(400, "SKILL_NAME_MISMATCH", "Tên skill không khớp markdown.");
  if (input.instance && input.instance !== agent.instance && input.instance !== agent.name) throw new AppError(403, "FLEET_IDENTITY_MISMATCH", "Danh tính không khớp khóa máy.");
  let size = 0;
  for (const [path, content] of Object.entries(input.files)) {
    if (path === "SKILL.md") throw new AppError(400, "FLEET_BAD_FILE", "SKILL.md phải gửi ở markdown.");
    FleetFileSchema.parse({ path: `${input.name}/${path}`, content });
    size += Buffer.byteLength(content);
    if (size > 1_048_576 || redactExportText(content) !== content) throw new AppError(400, "FLEET_BAD_FILE", "Tệp hỗ trợ quá lớn hoặc chứa dữ liệu nhạy cảm.");
  }
  const registry = skillRegistry();
  // TASK-074b: reuse its behaviour/shadow gate when that task lands; today's routing eval remains mandatory.
  const saved = saveSkillDraft(db, input.markdown, { source: "agent_proposal", sourceKind: agent.kind, sourceInstance: agent.instance, parentVersion: input.parentVersion, files: input.files, reason: input.evidence.reason, runIds: input.evidence.runIds, caller: agent.instance }, registry);
  if (!saved) throw new AppError(429, "SKILL_DRAFT_LIMIT", "Đã đạt giới hạn bản nháp trong ngày.");
  const row = listSkillVersions(db).find((s) => s.name === saved.name && s.version === saved.version)!;
  const parsed = parseSkillMarkdown(row.markdown)!;
  const allText = [row.markdown, ...Object.values(input.files)].join("\n");
  const mutatingNamed = [...registry].some(([name, risk]) => risk !== "read" && new RegExp(`\\b${name}\\b`).test(allText));
  if (fleetSettings(db).autoActivateReadOnlySkills && row.status === "draft" && row.score >= SKILL_EVAL_MIN_SCORE && parsed.tools.every((tool) => registry.get(tool) === "read") && !mutatingNamed) {
    activateSkillVersion(db, saved.name, saved.version, registry);
    return { ...saved, status: "active" };
  }
  return { ...saved, status: row.status };
}
