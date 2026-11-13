import { shelvedDigestLines } from "./repairDigest.js";
import { stampWorkspace, workspaceOfProfile } from "../auth/requestContext.js";
import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  AUTONOMY_PRESETS, GoalSpecSchema, PreferenceScopeSchema, RequestKindSchema, actionUrlAllowed, capGoalVideos,
  fairShareTurn, goalCapacityWarning, quietHoursHold, topicIsSensitive,
  type GoalSpec, type PreferenceScope, type RequestKind,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { UsageService } from "../services/usageService.js";
import { autonomyBudgetStatus } from "./autonomyBudget.js";
import { effectiveAutonomy, saveAutonomySettings } from "./autonomy.js";
import { setAutomationPaused } from "../services/automationSettings.js";

const DAY = 24 * 60 * 60 * 1000;
export const TEMP_CACHE_DIRS = ["tmp", "cache"] as const;

type Clock = () => Date;

function nowIso(now: Clock): string {
  return now().toISOString();
}

export function saveGoal(sqlite: Database.Database, input: {
  profileId?: string | null;
  text: string;
  spec: unknown;
  source: "web" | "telegram" | "assistant";
  uploadsPerDay?: number;
  now?: Clock;
}): { id: string; spec: GoalSpec; warning: string | null } {
  const spec = GoalSpecSchema.parse(input.spec);
  const warning = goalCapacityWarning(spec, input.uploadsPerDay);
  const at = nowIso(input.now ?? (() => new Date()));
  const id = randomUUID();
  sqlite.prepare("UPDATE operator_goals SET status = 'replaced', updated_at = ? WHERE status = 'active' AND profile_id IS ?")
    .run(at, input.profileId ?? null);
  sqlite.prepare(`INSERT INTO operator_goals (id, profile_id, text, spec, status, created_at, updated_at, source)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`).run(id, input.profileId ?? null, input.text, JSON.stringify(spec), at, at, input.source);
  stampWorkspace(sqlite, "operator_goals", id, input.profileId ? workspaceOfProfile(sqlite, input.profileId) : null);
  return { id, spec, warning };
}

export function listGoals(sqlite: Database.Database, profileId?: string | null) {
  return sqlite.prepare(`SELECT id, profile_id AS profileId, text, spec, status, created_at AS createdAt, source
    FROM operator_goals WHERE (? IS NULL OR profile_id IS ?) ORDER BY updated_at DESC LIMIT 20`)
    .all(profileId ?? null, profileId ?? null) as Array<Record<string, unknown>>;
}

export function activeGoal(sqlite: Database.Database, profileId: string): { id: string; spec: GoalSpec; text: string } | null {
  const row = sqlite.prepare("SELECT id, text, spec FROM operator_goals WHERE profile_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1")
    .get(profileId) as { id: string; text: string; spec: string } | undefined;
  return row ? { id: row.id, text: row.text, spec: GoalSpecSchema.parse(JSON.parse(row.spec)) } : null;
}

export function applyGoalToAutomation(sqlite: Database.Database, profileId: string, now: Clock = () => new Date()): { applied: boolean; plan: Record<string, unknown> } {
  const goal = activeGoal(sqlite, profileId);
  if (!goal) return { applied: false, plan: {} };
  const { grants } = effectiveAutonomy(sqlite, { profileId });
  const videos = capGoalVideos(goal.spec);
  const publishTime = goal.spec.publishTime ?? "20:00";
  const plan = {
    day: now().toISOString().slice(0, 10),
    videos,
    publishTime,
    topicFocus: goal.spec.topicFocus,
    capped: Boolean(goalCapacityWarning(goal.spec)),
  };
  if (grants.strategy) {
    const row = sqlite.prepare("SELECT automation FROM profiles WHERE id = ?").get(profileId) as { automation: string | null } | undefined;
    const current = row?.automation ? JSON.parse(row.automation) as Record<string, unknown> : {};
    sqlite.prepare("UPDATE profiles SET automation = ? WHERE id = ?").run(JSON.stringify({
      ...current,
      enabled: true,
      videosPerDay: videos,
      publishTimes: [publishTime],
      autoShorts: goal.spec.formats.includes("shorts"),
      shortsPerVideo: goal.spec.formats.includes("shorts") ? 2 : current.shortsPerVideo ?? 3,
    }), profileId);
  }
  sqlite.prepare("UPDATE operator_goals SET spec = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify({ ...goal.spec, plan }), now().toISOString(), goal.id);
  return { applied: grants.strategy, plan };
}

export function goalIsBehind(published: number, planned: number): boolean {
  return published < planned - 1;
}

export function savePreference(sqlite: Database.Database, input: {
  profileId?: string | null;
  rule: string;
  quote: string;
  scope: PreferenceScope[];
  conflicts?: string[];
  guideline?: string;
  now?: Clock;
}): { id: string; retired: string[]; note?: string; active?: false } {
  const scopes = input.scope.map((item) => PreferenceScopeSchema.parse(item));
  const at = nowIso(input.now ?? (() => new Date()));
  const retired: string[] = [];
  const rows = sqlite.prepare("SELECT id, rule FROM operator_preferences WHERE active = 1 AND profile_id IS ?")
    .all(input.profileId ?? null) as Array<{ id: string; rule: string }>;
  for (const row of rows) {
    const clash = input.conflicts?.includes(row.id) || opposite(row.rule, input.rule);
    if (clash) {
      sqlite.prepare("UPDATE operator_preferences SET active = 0 WHERE id = ?").run(row.id);
      retired.push(row.rule);
    }
  }
  const id = randomUUID();
  const verdict = input.guideline ? guidelineWins(input.rule, input.guideline) : { follow: "feedback" as const };
  const inactive = verdict.follow === "guideline";
  sqlite.prepare(`INSERT INTO operator_preferences (id, profile_id, rule, quote, scope, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.profileId ?? null, input.rule, inactive ? verdict.note : input.quote, scopes.join(","), at, inactive ? 0 : 1,
  );
  stampWorkspace(sqlite, "operator_preferences", id, input.profileId ? workspaceOfProfile(sqlite, input.profileId) : null);
  return inactive ? { id, retired, note: verdict.note, active: false as const } : { id, retired };
}

function opposite(previous: string, next: string): boolean {
  const pairs = [["vui", "buồn"], ["nhanh", "chậm"], ["to", "nhỏ"]];
  const a = previous.toLowerCase();
  const b = next.toLowerCase();
  return pairs.some(([left, right]) => (a.includes(left!) && b.includes(right!)) || (a.includes(right!) && b.includes(left!)));
}

export function preferenceBlock(sqlite: Database.Database, profileId: string | null, scope: PreferenceScope): string {
  const rows = sqlite.prepare(`SELECT rule, quote FROM operator_preferences
    WHERE active = 1 AND (profile_id IS ? OR profile_id IS NULL) AND instr(scope, ?) > 0 ORDER BY created_at`)
    .all(profileId, scope) as Array<{ rule: string; quote: string }>;
  if (!rows.length) return "";
  return ["Yêu cầu của chủ kênh:", ...rows.map((row) => `- ${row.rule} (trích: "${row.quote}")`)].join("\n");
}

export function questionsUsedToday(sqlite: Database.Database, day: string): number {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM operator_requests WHERE kind = 'info' AND created_at LIKE ?")
    .get(`${day}%`) as { n: number };
  return row.n;
}

export function createUserRequest(sqlite: Database.Database, input: {
  profileId?: string | null;
  kind: RequestKind;
  title: string;
  whyVi: string;
  actionUrl: string;
  dedupeKey: string;
  checkKind: string;
  checkArgs?: unknown;
  omniOrigin?: string;
  maxQuestionsPerDay?: number;
  now?: Clock;
}): { id: string; created: boolean } {
  const kind = RequestKindSchema.parse(input.kind);
  if (!actionUrlAllowed(input.actionUrl, input.omniOrigin)) {
    throw new AppError(400, "ACTION_URL", "Liên kết phải là trang trong app hoặc bảng OmniRoute đã cấu hình.");
  }
  const existing = sqlite.prepare("SELECT id FROM operator_requests WHERE dedupe_key = ? AND status = 'open'").get(input.dedupeKey) as { id: string } | undefined;
  if (existing) return { id: existing.id, created: false };
  const at = nowIso(input.now ?? (() => new Date()));
  if (kind !== "needs_key" && kind !== "reconnect_account") {
    const cap = input.maxQuestionsPerDay ?? 3;
    if (questionsUsedToday(sqlite, at.slice(0, 10)) >= cap) {
      throw new AppError(429, "QUESTION_CAP", "Đã hết số câu hỏi trong ngày. Phần còn lại vào bản tin.");
    }
  }
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO operator_requests
    (id, profile_id, kind, title, why_vi, action_url, dedupe_key, status, created_at, check_kind, check_args)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`).run(
    id, input.profileId ?? null, kind, input.title, input.whyVi, input.actionUrl, input.dedupeKey, at,
    input.checkKind, JSON.stringify(input.checkArgs ?? {}),
  );
  return { id, created: true };
}

export function listOpenRequests(sqlite: Database.Database) {
  return sqlite.prepare(`SELECT id, profile_id AS profileId, kind, title, why_vi AS whyVi, action_url AS actionUrl, status, created_at AS createdAt
    FROM operator_requests WHERE status = 'open' ORDER BY created_at DESC LIMIT 30`).all();
}

export function closeRequest(sqlite: Database.Database, id: string, status: "done" | "dismissed" | "expired", now: Clock = () => new Date()): void {
  sqlite.prepare("UPDATE operator_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'open'")
    .run(status, now().toISOString(), id);
}

export function expireOldRequests(sqlite: Database.Database, now: Clock = () => new Date()): number {
  const cutoff = new Date(now().getTime() - 14 * DAY).toISOString();
  return sqlite.prepare("UPDATE operator_requests SET status = 'expired', resolved_at = ? WHERE status = 'open' AND created_at < ?")
    .run(now().toISOString(), cutoff).changes;
}

export function touchFromOwner(headers: Record<string, unknown>, sqlite: Database.Database, objectKey: string, now: Clock = () => new Date()): void {
  if (headers["x-vg-tool-source"] !== undefined) return;
  markUserTouch(sqlite, objectKey, now);
}

export function markUserTouch(sqlite: Database.Database, objectKey: string, now: Clock = () => new Date()): void {
  sqlite.prepare(`INSERT INTO operator_user_touches (object_key, touched_at) VALUES (?, ?)
    ON CONFLICT(object_key) DO UPDATE SET touched_at = excluded.touched_at`).run(objectKey, now().toISOString());
}

export function agentMayChange(sqlite: Database.Database, objectKey: string, now: Clock = () => new Date()): boolean {
  const row = sqlite.prepare("SELECT touched_at AS at FROM operator_user_touches WHERE object_key = ?").get(objectKey) as { at: string } | undefined;
  if (!row) return true;
  return now().getTime() - Date.parse(row.at) >= DAY;
}

export function cleanupTempCache(root: string, now: Date): string[] {
  const removed: string[] = [];
  const cutoff = now.getTime() - 3 * DAY;
  for (const name of TEMP_CACHE_DIRS) {
    const dir = join(root, name);
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const file of entries) {
      const path = join(dir, file);
      if (!path.startsWith(join(root, name))) continue;
      const stat = statSync(path);
      if (stat.mtimeMs < cutoff) {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
      }
    }
  }
  return removed;
}

export function stalledBackoffMinutes(attempt: number): number | null {
  return [1, 5, 20][attempt] ?? null;
}

export type RouteSnapshot = { provider: string; model: string };

export function routeCostOk(projectedDailyUsd: number, dailyUsd: number | null): boolean {
  return dailyUsd == null || projectedDailyUsd <= dailyUsd;
}

export function startCanary(sqlite: Database.Database, input: {
  profileId: string;
  stage: string;
  before: RouteSnapshot;
  after: RouteSnapshot;
  reason: string;
  configured: boolean;
  projectedDailyUsd: number;
  dailyUsd: number | null;
  now?: Clock;
}): { id: string } {
  if (!input.configured) throw new AppError(400, "MODEL_UNCONFIGURED", "Model chưa được cấu hình.");
  if (!routeCostOk(input.projectedDailyUsd, input.dailyUsd)) {
    throw new AppError(400, "ROUTE_COST", "Đổi model này vượt hạn mức ngày.");
  }
  if (!agentMayChange(sqlite, `route:${input.profileId}:${input.stage}`, input.now)) {
    throw new AppError(409, "USER_TOUCHED", "Bạn vừa sửa định tuyến. Agent chờ 24 giờ.");
  }
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO routing_canaries (id, profile_id, stage, before, after, reason, remaining, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 2, 'canary', ?)`).run(
    id, input.profileId, input.stage, JSON.stringify(input.before), JSON.stringify(input.after), input.reason,
    (input.now ?? (() => new Date()))().toISOString(),
  );
  return { id };
}

export function finishCanary(sqlite: Database.Database, id: string, sample: { quality: number; baselineQuality: number; failures: number }): "promoted" | "rolled_back" | "running" {
  const row = sqlite.prepare("SELECT remaining, before FROM routing_canaries WHERE id = ?").get(id) as { remaining: number; before: string } | undefined;
  if (!row) throw new AppError(404, "CANARY", "Không thấy bản thử.");
  const remaining = row.remaining - 1;
  if (remaining > 0) {
    sqlite.prepare("UPDATE routing_canaries SET remaining = ? WHERE id = ?").run(remaining, id);
    return "running";
  }
  const worse = sample.quality < sample.baselineQuality || sample.failures > 0;
  sqlite.prepare("UPDATE routing_canaries SET remaining = 0, status = ? WHERE id = ?").run(worse ? "rolled_back" : "promoted", id);
  return worse ? "rolled_back" : "promoted";
}

export function canaryUndo(sqlite: Database.Database, id: string): RouteSnapshot {
  const row = sqlite.prepare("SELECT before FROM routing_canaries WHERE id = ?").get(id) as { before: string } | undefined;
  if (!row) throw new AppError(404, "CANARY", "Không thấy bản thử.");
  sqlite.prepare("UPDATE routing_canaries SET status = 'rolled_back', remaining = 0 WHERE id = ?").run(id);
  return JSON.parse(row.before) as RouteSnapshot;
}

const ALLOWED_PROVIDER_PATCH = new Set(["isActive", "priority", "rateLimit", "modelAllowlist"]);

export function providerPatchAllowed(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => ALLOWED_PROVIDER_PATCH.has(key));
}

export function stripProviderCredentials(raw: Record<string, unknown>) {
  return {
    id: String(raw.id ?? ""),
    provider: String(raw.provider ?? raw.type ?? ""),
    label: String(raw.label ?? raw.name ?? ""),
    active: Boolean(raw.isActive ?? raw.active),
    priority: Number(raw.priority ?? 0),
    modelCount: Array.isArray(raw.models) ? raw.models.length : Number(raw.modelCount ?? 0),
    lastTest: raw.lastTestResult ?? raw.lastTest ?? null,
  };
}

export function readDrain(sqlite: Database.Database): { draining: boolean; since: string | null } {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'autonomy.drain'").get() as { value: string } | undefined;
  if (!row) return { draining: false, since: null };
  const parsed = JSON.parse(row.value) as { draining?: boolean; since?: string };
  return { draining: parsed.draining === true, since: parsed.since ?? null };
}

export function setDrain(sqlite: Database.Database, draining: boolean, now: Clock = () => new Date()): { draining: boolean; since: string | null } {
  const since = draining ? now().toISOString() : null;
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.drain', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(JSON.stringify({ draining, since }), now().toISOString());
  return { draining, since };
}

export function stopAutonomy(sqlite: Database.Database): void {
  const profiles = sqlite.prepare("SELECT id FROM profiles WHERE archived_at IS NULL").all() as Array<{ id: string }>;
  const assist = { level: "assist" as const, grants: AUTONOMY_PRESETS.assist };
  saveAutonomySettings(sqlite, assist);
  for (const profile of profiles) saveAutonomySettings(sqlite, assist, profile.id);
  setAutomationPaused(sqlite, true);
}

export function raiseCode(sqlite: Database.Database, now: Clock = () => new Date()): string {
  const code = String(randomInt(100000, 1000000));
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.raiseCode', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(JSON.stringify({ code, expiresAt: new Date(now().getTime() + 10 * 60 * 1000).toISOString(), failures: [] }), now().toISOString());
  return code;
}

export function consumeRaiseCode(sqlite: Database.Database, code: string, now: Clock = () => new Date()): boolean {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'autonomy.raiseCode'").get() as { value: string } | undefined;
  if (!row) return false;
  const parsed = JSON.parse(row.value) as { code: string; expiresAt: string; failures?: string[]; lockedUntil?: string };
  const at = now();
  if (parsed.lockedUntil && Date.parse(parsed.lockedUntil) > at.getTime()) return false;
  const recent = (parsed.failures ?? []).filter((stamp) => at.getTime() - Date.parse(stamp) < 10 * 60 * 1000);
  if (recent.length >= 5) {
    parsed.lockedUntil = new Date(at.getTime() + 10 * 60 * 1000).toISOString();
    sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.raiseCode', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(JSON.stringify(parsed), at.toISOString());
    sqlite.prepare(`INSERT INTO supervisor_findings
      (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
      VALUES (?, NULL, 'raise_code', 'warn', 'raise-code:lockout', ?, ?, ?, 'open')
      ON CONFLICT(dedupe_key) DO NOTHING`).run(
      randomUUID(),
      JSON.stringify({ message: "Năm mã sai trong 10 phút. Tạm khóa 10 phút." }),
      at.toISOString(),
      at.toISOString(),
    );
    return false;
  }
  const left = Buffer.from(parsed.code);
  const right = Buffer.from(code);
  const match = left.length === right.length && timingSafeEqual(left, right) && Date.parse(parsed.expiresAt) > at.getTime();
  if (!match) {
    parsed.failures = [...recent, at.toISOString()];
    sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.raiseCode', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(JSON.stringify(parsed), at.toISOString());
    return false;
  }
  sqlite.prepare("DELETE FROM app_settings WHERE key = 'autonomy.raiseCode'").run();
  return true;
}

export function nextFairProfile(sqlite: Database.Database, profileIds: string[]): string {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'autonomy.fairCursor'").get() as { value: string } | undefined;
  const cursor = row ? Number(JSON.parse(row.value)) : 0;
  const turn = fairShareTurn(profileIds, Number.isFinite(cursor) ? cursor : 0);
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.fairCursor', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(JSON.stringify(turn.next), new Date().toISOString());
  return turn.profileId;
}

function digestSpend(sqlite: Database.Database, at: Date): { state: string; used?: number; limit?: number | null } {
  try {
    const status = autonomyBudgetStatus(sqlite, new UsageService(sqlite, 25000), undefined, at);
    const scope = status.scopes[0];
    return { state: status.state, used: scope?.spend.dailyUsd, limit: scope?.limits.dailyUsd ?? null };
  } catch {
    return { state: "unknown" };
  }
}

function readRows(sqlite: Database.Database, sql: string, ...args: unknown[]): Array<Record<string, unknown>> {
  try {
    return sqlite.prepare(sql).all(...args) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

export function buildDigest(sqlite: Database.Database, now: Clock = () => new Date()) {
  const at = now();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(at);
  const requests = listOpenRequests(sqlite);
  const goals = listGoals(sqlite, null).filter((row) => row.status === "active");
  const findings = readRows(sqlite, "SELECT kind, status, resolution, severity, dedupe_key FROM supervisor_findings WHERE last_seen_at LIKE ?", `${day}%`);
  const published = readRows(sqlite, `SELECT platform, title, visibility, link FROM (
      SELECT a.platform AS platform, pr.title AS title, p.visibility_used AS visibility, p.external_url AS link, p.published_at AS at
      FROM publications p
      JOIN projects pr ON pr.id = p.project_id
      JOIN platform_accounts a ON a.id = p.account_id
      WHERE p.status = 'PUBLISHED' AND p.published_at LIKE ?
    )`, `${day}%`);
  const inProgress = readRows(sqlite, `SELECT pr.title AS title, j.stage AS stage, j.message AS waiting
    FROM jobs j JOIN projects pr ON pr.id = j.project_id
    WHERE j.status IN ('QUEUED', 'RUNNING')`);
  const heldRow = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'autonomy.heldGates'").get() as { value: string } | undefined;
  const held = heldRow ? JSON.parse(heldRow.value) as unknown[] : [];
  const strikes = findings.filter((row) => String(row.dedupe_key ?? "").startsWith("strike:") || row.kind === "strike");
  const tomorrow = goals.map((goal) => {
    const plan = (goal.spec as { plan?: { videos?: number } } | undefined)?.plan;
    return plan?.videos ? `${goal.text}: ${plan.videos} video` : goal.text;
  });
  return {
    day,
    published,
    inProgress,
    held,
    findings,
    strikes,
    requests,
    goals,
    spend: digestSpend(sqlite, at),
    spendNote: "Chi tiết chi phí nằm ở Mức dùng.",
    shelved: shelvedDigestLines(sqlite, day),
    tomorrow,
  };
}

export function alertWaitsForMorning(severity: "info" | "warn" | "critical", now: Date, timeZone = "Asia/Ho_Chi_Minh"): boolean {
  return severity !== "critical" && quietHoursHold(now, timeZone);
}

export function sensitivePublish(topic: string, grant: "never" | "private" | "unlisted" | "public") {
  return topicIsSensitive(topic) ? { visibility: grant === "never" ? "never" as const : "private" as const, request: true } : { visibility: grant, request: false };
}

export function guidelineWins(feedback: string, guideline: string): { follow: "guideline"; note: string } | { follow: "feedback" } {
  if (/không đăng|cấm|không được/i.test(guideline) && /đăng|bỏ qua/i.test(feedback)) {
    return { follow: "guideline", note: "Góp ý mâu thuẫn với định hướng nội dung. App giữ định hướng." };
  }
  return { follow: "feedback" };
}
