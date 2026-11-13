import {
  NEEDS_TOKEN_STEPS_VI,
  connectionProbeAllowed,
  connectionStates,
  probeAllowedToday,
  type AccountStatus,
} from "@vg/shared";

export const INTEL_USER_AGENT = "video-agent-provider-intel/1.0";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type AuditConnection = {
  id: string;
  provider: string;
  label: string;
  authType: string | null;
  credentialPresent: boolean;
  states: AccountStatus[];
  models: string[];
  probeSkipped: boolean;
  error: string | null;
};

export type AuditResult = {
  needsToken: boolean;
  stepsVi: string | null;
  connections: AuditConnection[];
  gatewayModels: string[];
};

type Logger = { warn?: (obj: unknown, msg?: string) => void; info?: (obj: unknown, msg?: string) => void };

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  credential: string | null,
  timeoutMs: number,
  method: "GET" | "POST" = "GET",
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": INTEL_USER_AGENT };
  if (credential) headers.authorization = `Bearer ${credential}`;
  const response = await fetchImpl(url, { method, headers, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export async function auditOmniRoute(input: {
  origin: string;
  managementToken: string | null;
  apiKey: string | null;
  fetchImpl: FetchLike;
  quotaExhausted?: (connectionId: string) => boolean;
  lastProbeAt?: (model: string) => string | null;
  now?: Date;
  logger?: Logger;
}): Promise<AuditResult> {
  const now = input.now ?? new Date();
  const gateway = await listGatewayModels(input).catch(() => [] as string[]);
  if (!input.managementToken) {
    input.logger?.info?.({ code: "needs_token" }, "omniroute audit needs token");
    return { needsToken: true, stepsVi: NEEDS_TOKEN_STEPS_VI, connections: [], gatewayModels: gateway };
  }
  const providers = await getJson(input.fetchImpl, `${input.origin}/api/providers`, input.managementToken, 15_000);
  if (providers.status === 401 || providers.status === 403) {
    return { needsToken: true, stepsVi: NEEDS_TOKEN_STEPS_VI, connections: [], gatewayModels: gateway };
  }
  const list = Array.isArray((providers.body as { connections?: unknown })?.connections)
    ? (providers.body as { connections: Array<Record<string, unknown>> }).connections
    : Array.isArray(providers.body) ? providers.body as Array<Record<string, unknown>> : [];
  const connections: AuditConnection[] = [];
  for (const raw of list) {
    const id = String(raw.id ?? "");
    if (!id) continue;
    const authType = typeof raw.authType === "string" ? raw.authType : typeof raw.type === "string" ? raw.type : null;
    const probeOkAuth = connectionProbeAllowed({ authType, type: authType });
    let testOk = false;
    let invalid = false;
    let rateLimited = false;
    let error: string | null = null;
    if (probeOkAuth) {
      const test = await getJson(input.fetchImpl, `${input.origin}/api/providers/${encodeURIComponent(id)}/test`, input.managementToken, 15_000, "POST");
      testOk = test.status >= 200 && test.status < 300;
      invalid = test.status === 401 || test.status === 403;
      rateLimited = test.status === 429;
      if (!testOk) error = `HTTP ${test.status}`;
    }
    const modelsResponse = await getJson(input.fetchImpl, `${input.origin}/api/providers/${encodeURIComponent(id)}/models`, input.managementToken, 15_000);
    const models = readModelIds(modelsResponse.body);
    const exhausted = input.quotaExhausted?.(id) === true;
    const states = connectionStates({
      configured: true,
      credentialPresent: raw.credentialPresent === true || raw.hasCredential === true || Boolean(raw.apiKey),
      testOk,
      modelsDiscovered: models.length > 0,
      probeOk: false,
      rateLimited,
      quotaExhausted: exhausted,
      expired: raw.expired === true,
      invalidCredentials: invalid,
    });
    connections.push({
      id,
      provider: String(raw.provider ?? raw.name ?? id),
      label: String(raw.label ?? raw.name ?? raw.provider ?? id),
      authType,
      credentialPresent: states.includes("AUTHENTICATED"),
      states,
      models,
      probeSkipped: !probeOkAuth,
      error,
    });
  }
  return { needsToken: false, stepsVi: null, connections, gatewayModels: gateway };
}

async function listGatewayModels(input: { origin: string; apiKey: string | null; managementToken: string | null; fetchImpl: FetchLike }): Promise<string[]> {
  if (!input.apiKey && !input.managementToken) return [];
  const response = await getJson(input.fetchImpl, `${input.origin}/v1/models`, input.apiKey ?? input.managementToken, 15_000);
  return readModelIds(response.body);
}

function readModelIds(body: unknown): string[] {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
    ? (body as { data: Array<{ id?: string }> }).data
    : Array.isArray(body) ? body as Array<{ id?: string }> : [];
  return data.map((item) => String(item.id ?? "")).filter(Boolean);
}

export async function runModelProbe(input: {
  origin: string;
  apiKey: string | null;
  model: string;
  fetchImpl: FetchLike;
  lastProbeAt: string | null;
  now: Date;
  cookie: boolean;
}): Promise<{ skipped: boolean; ok: boolean; latencyMs: number; errorKind: string | null }> {
  if (input.cookie || !probeAllowedToday(input.lastProbeAt, input.now)) {
    return { skipped: true, ok: false, latencyMs: 0, errorKind: null };
  }
  const started = Date.now();
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": INTEL_USER_AGENT };
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
  const response = await input.fetchImpl(`${input.origin}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - started;
  if (response.ok) return { skipped: false, ok: true, latencyMs, errorKind: null };
  const errorKind = response.status === 401 || response.status === 403 ? "auth"
    : response.status === 429 ? "rate_limit"
      : response.status === 404 ? "not_found"
        : response.status >= 500 ? "outage"
          : "other";
  return { skipped: false, ok: false, latencyMs, errorKind };
}

export async function updateOmnirouteCombos(input: {
  origin: string;
  token: string;
  fetchImpl: FetchLike;
  profiles: Array<{ id: string; models: string[] }>;
  retestIds: string[];
}): Promise<{
  wrote: boolean;
  backupId: string | null;
  error: string | null;
  regression: boolean;
  restoreStepsVi: string | null;
}> {
  const backup = await getJson(input.fetchImpl, `${input.origin}/api/db-backups/export`, input.token, 15_000, "POST");
  if (backup.status < 200 || backup.status >= 300) {
    return { wrote: false, backupId: null, error: "Backup thất bại, không ghi combo.", regression: false, restoreStepsVi: null };
  }
  const backupId = String((backup.body as { id?: string })?.id ?? (backup.body as { backupId?: string })?.backupId ?? "backup");
  const current = await getJson(input.fetchImpl, `${input.origin}/api/combos`, input.token, 15_000);
  const combos = Array.isArray((current.body as { combos?: unknown })?.combos)
    ? (current.body as { combos: Array<Record<string, unknown>> }).combos
    : Array.isArray(current.body) ? current.body as Array<Record<string, unknown>> : [];
  const kept = combos.filter((combo) => !String(combo.name ?? "").startsWith("va-"));
  const next = [
    ...kept,
    ...input.profiles.map((profile) => ({ name: `va-${profile.id}`, models: profile.models })),
  ];
  const write = await input.fetchImpl(`${input.origin}/api/combos`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
      "user-agent": INTEL_USER_AGENT,
    },
    body: JSON.stringify({ combos: next }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!write.ok) {
    return { wrote: false, backupId, error: `Ghi combo lỗi HTTP ${write.status}`, regression: false, restoreStepsVi: restoreText(backupId) };
  }
  let regression = false;
  for (const id of input.retestIds) {
    const test = await getJson(input.fetchImpl, `${input.origin}/api/providers/${encodeURIComponent(id)}/test`, input.token, 15_000, "POST");
    if (test.status < 200 || test.status >= 300) regression = true;
  }
  return {
    wrote: true,
    backupId,
    error: null,
    regression,
    restoreStepsVi: regression ? restoreText(backupId) : null,
  };
}

function restoreText(backupId: string): string {
  return `Khôi phục bằng backup ${backupId}: gọi API /api/db-backups với id này. Bấm nút khôi phục, ứng dụng không tự khôi phục.`;
}

/**
 * Management calls checked against OmniRoute OpenAPI 3.8.53:
 * https://raw.githubusercontent.com/cheaper-inference/OmniRoute/v3.8.53/docs/openapi.yaml
 * Export is GET /api/db-backups/export (the older combo writer still POSTs).
 * Model list is GET /api/v1/models.
 */
export type OmniManage = { origin: string; token: string | null; fetchImpl: FetchLike };

let manageReader: (() => OmniManage) | null = null;
export function setOmnirouteManageReader(reader: (() => OmniManage) | null): void {
  manageReader = reader;
}
export function omnirouteManage(): OmniManage {
  if (!manageReader) throw new Error("OmniRoute chưa được nối.");
  return manageReader();
}

const PROVIDER_PATCH = new Set(["isActive", "priority", "rateLimit", "modelAllowlist"]);

export function assertProviderPatch(body: Record<string, unknown>): void {
  const extra = Object.keys(body).filter((key) => !PROVIDER_PATCH.has(key));
  if (extra.length) throw new Error(`Từ chối trường OmniRoute: ${extra.join(", ")}`);
}

async function exportBackup(input: OmniManage): Promise<string> {
  const backup = await getJson(input.fetchImpl, `${input.origin}/api/db-backups/export`, input.token, 15_000);
  if (backup.status < 200 || backup.status >= 300) throw new Error("Không xuất được bản sao OmniRoute.");
  const body = backup.body as { id?: string; backupId?: string } | null;
  return String(body?.backupId ?? body?.id ?? "backup");
}

export async function readOmnirouteHealth(input: OmniManage) {
  const health = await getJson(input.fetchImpl, `${input.origin}/api/monitoring/model-health?unhealthy=1`, input.token, 15_000);
  const models = await getJson(input.fetchImpl, `${input.origin}/api/v1/models`, input.token, 15_000);
  return { unhealthy: health.body, modelsReachable: models.status >= 200 && models.status < 300 };
}

export async function readOmnirouteProviders(input: OmniManage) {
  const providers = await getJson(input.fetchImpl, `${input.origin}/api/providers`, input.token, 15_000);
  const list = Array.isArray((providers.body as { connections?: unknown })?.connections)
    ? (providers.body as { connections: Array<Record<string, unknown>> }).connections
    : Array.isArray(providers.body) ? providers.body as Array<Record<string, unknown>> : [];
  return list.map((raw) => ({
    id: String(raw.id ?? ""),
    provider: String(raw.provider ?? raw.type ?? ""),
    label: String(raw.label ?? raw.name ?? ""),
    active: Boolean(raw.isActive ?? raw.active),
    priority: Number(raw.priority ?? 0),
    modelCount: Array.isArray(raw.models) ? raw.models.length : 0,
    lastTest: raw.lastTestResult ?? null,
  }));
}

export async function testOmnirouteProvider(input: OmniManage, id: string) {
  return getJson(input.fetchImpl, `${input.origin}/api/providers/${encodeURIComponent(id)}/test`, input.token, 15_000, "POST");
}

export async function patchOmnirouteProvider(input: OmniManage, id: string, body: Record<string, unknown>) {
  assertProviderPatch(body);
  const backupId = await exportBackup(input);
  const response = await input.fetchImpl(`${input.origin}/api/providers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${input.token}`, "user-agent": INTEL_USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { backupId, status: response.status };
}

export async function readOmnirouteCombos(input: OmniManage) {
  const [combos, metrics] = await Promise.all([
    getJson(input.fetchImpl, `${input.origin}/api/combos`, input.token, 15_000),
    getJson(input.fetchImpl, `${input.origin}/api/combos/metrics`, input.token, 15_000),
  ]);
  return { combos: combos.body, metrics: metrics.body };
}

export async function upsertOmnirouteCombo(input: OmniManage, combo: { id?: string; name: string; models: string[] }, knownModels: string[]) {
  if (combo.models.some((model) => !knownModels.includes(model))) throw new Error("Combo chỉ dùng model của kết nối đang có.");
  const backupId = await exportBackup(input);
  const path = combo.id ? `${input.origin}/api/combos/${encodeURIComponent(combo.id)}` : `${input.origin}/api/combos`;
  const response = await input.fetchImpl(path, {
    method: combo.id ? "PUT" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${input.token}`, "user-agent": INTEL_USER_AGENT },
    body: JSON.stringify({ name: combo.name, models: combo.models }),
    signal: AbortSignal.timeout(15_000),
  });
  const test = await getJson(input.fetchImpl, `${input.origin}/api/combos/test`, input.token, 15_000, "POST");
  return { backupId, status: response.status, testStatus: test.status };
}

export async function deleteAppCombo(input: OmniManage, combo: { id: string; name: string }) {
  if (!combo.name.startsWith("vg-")) throw new Error("Chỉ xoá combo do app tạo, tên bắt đầu bằng vg-.");
  const backupId = await exportBackup(input);
  const response = await input.fetchImpl(`${input.origin}/api/combos/${encodeURIComponent(combo.id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${input.token}`, "user-agent": INTEL_USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  return { backupId, status: response.status };
}
