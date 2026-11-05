import { createHash, randomUUID } from "node:crypto";
import {
  JobUsageSchema,
  LLM_TASKS,
  ModelAdvisorOutputSchema,
  ModelAdvisorProposalSchema,
  type BudgetMode,
  type LlmSettings,
  type LlmTaskId,
  type ModelAdvisorDiffEntry,
  type ModelAdvisorOutput,
  type ModelAdvisorProposal,
  type ModelAdvisorRoutePick,
  type ModelAdvisorScope,
  type ProfileLlmSettings,
  type Project,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { getAppLlmSettings, saveAppLlmSettings } from "../providers/llm/settings.js";
import { LlmCache } from "../providers/llm/cache.js";
import { AppError } from "../lib/errors.js";
import type { ProjectService } from "./projectService.js";
import type { ProfileService } from "./profileService.js";

const PROPOSAL_CACHE_KEY = "llmAdvisorProposals";
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const HEALTH_WINDOW_DAYS = 7;
const CLI_PROVIDERS = new Set(["claude-cli", "copilot-cli", "antigravity-cli"]);
const KEEP_REASON = "giữ nguyên (đề xuất không hợp lệ)";

export type AdvisorCatalogModel = {
  provider: string;
  model: string;
  vision: boolean;
  subscription: boolean;
  pricing?: { inputPerMTok: number; outputPerMTok: number };
  contextWindow?: number;
};

export type AdvisorHealthBucket = {
  provider: string;
  model: string;
  calls: number;
  successRate: number;
  avgLatencyMs: number | null;
  parseFailures: number;
};

export type AdvisorTaskInput = {
  id: LlmTaskId;
  label: string;
  purpose: string;
  qualityWeight: 1 | 2 | 3;
  needsVision: boolean;
  needsLongContext: boolean;
  typicalTokens: { input: number; output: number };
};

type CachedProposalStore = {
  entries: Record<string, { createdAt: string; proposal: ModelAdvisorProposal }>;
};

export function buildAdvisorCatalog(
  registry: LlmProviderRegistry,
  modelLists: Record<string, string[]>,
): AdvisorCatalogModel[] {
  const providers = registry.list();
  const catalog: AdvisorCatalogModel[] = [];
  for (const info of providers) {
    if (!info.configured) continue;
    const provider = registry.get(info.id);
    const vision = provider?.capabilities?.vision === true;
    const subscription = CLI_PROVIDERS.has(info.id);
    const models = [...new Set([
      ...(info.defaultModel ? [info.defaultModel] : []),
      ...(modelLists[info.id] ?? []),
    ])];
    if (models.length === 0) {
      catalog.push({
        provider: info.id,
        model: info.defaultModel ?? info.id,
        vision,
        subscription,
      });
      continue;
    }
    for (const model of models) {
      let modelVision = vision;
      let pricing: AdvisorCatalogModel["pricing"];
      let contextWindow: number | undefined;
      if (info.id === "omniroute") {
        const omni = registry.omnirouteCatalog.peekModels().find((row) => row.id === model);
        if (omni?.vision !== undefined) modelVision = omni.vision;
        if (omni?.pricing) pricing = omni.pricing;
        if (omni?.contextWindow !== undefined) contextWindow = omni.contextWindow;
      }
      catalog.push({
        provider: info.id,
        model,
        vision: modelVision,
        subscription,
        ...(pricing ? { pricing } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
      });
    }
  }
  return catalog;
}

export function buildAdvisorHealth(sqlite: Database.Database, now = new Date()): AdvisorHealthBucket[] {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let rows: Array<{ usage: string; started_at: string | null; finished_at: string | null }> = [];
  try {
    rows = sqlite.prepare(
      `SELECT usage, started_at, finished_at FROM jobs
       WHERE created_at >= ? AND usage IS NOT NULL
       ORDER BY created_at DESC LIMIT 2000`,
    ).all(since) as typeof rows;
  } catch {
    return [];
  }

  type Acc = {
    provider: string;
    model: string;
    calls: number;
    ok: number;
    parseFailures: number;
    latencySum: number;
    latencyCount: number;
  };
  const buckets = new Map<string, Acc>();

  for (const row of rows) {
    let usage: ReturnType<typeof JobUsageSchema.parse>;
    try {
      usage = JobUsageSchema.parse(JSON.parse(row.usage) as unknown);
    } catch {
      continue;
    }
    const jobLatency = row.started_at && row.finished_at
      ? Math.max(0, Date.parse(row.finished_at) - Date.parse(row.started_at))
      : null;
    const calls = usage.calls ?? [];
    if (calls.length === 0 && usage.provider) {
      const key = `${usage.provider}:${usage.model ?? ""}`;
      const acc = buckets.get(key) ?? {
        provider: usage.provider,
        model: usage.model ?? "",
        calls: 0,
        ok: 0,
        parseFailures: 0,
        latencySum: 0,
        latencyCount: 0,
      };
      acc.calls += usage.llmCalls;
      acc.ok += usage.llmCalls;
      if (jobLatency !== null) {
        acc.latencySum += jobLatency;
        acc.latencyCount += 1;
      }
      buckets.set(key, acc);
      continue;
    }
    for (const call of calls) {
      if (call.cached) continue;
      const key = `${call.provider}:${call.model}`;
      const acc = buckets.get(key) ?? {
        provider: call.provider,
        model: call.model,
        calls: 0,
        ok: 0,
        parseFailures: 0,
        latencySum: 0,
        latencyCount: 0,
      };
      acc.calls += 1;
      if (call.ok) acc.ok += 1;
      else if (call.outputTokens === 0 && call.inputTokens > 0) acc.parseFailures += 1;
      else acc.parseFailures += 1;
      if (jobLatency !== null) {
        acc.latencySum += jobLatency;
        acc.latencyCount += 1;
      }
      buckets.set(key, acc);
    }
  }

  return [...buckets.values()].map((acc) => ({
    provider: acc.provider,
    model: acc.model,
    calls: acc.calls,
    successRate: acc.calls > 0 ? acc.ok / acc.calls : 0,
    avgLatencyMs: acc.latencyCount > 0 ? Math.round(acc.latencySum / acc.latencyCount) : null,
    parseFailures: acc.parseFailures,
  }));
}

/** Coarse health buckets for the cache key (avoid churn from exact latency). */
export function healthBucketsForCache(health: AdvisorHealthBucket[]): Array<{
  provider: string;
  model: string;
  successBand: "high" | "mid" | "low" | "none";
  parseBand: "ok" | "some" | "many";
}> {
  return health
    .map((row) => ({
      provider: row.provider,
      model: row.model,
      successBand: row.calls === 0 ? "none" as const
        : row.successRate >= 0.9 ? "high" as const
          : row.successRate >= 0.7 ? "mid" as const
            : "low" as const,
      parseBand: row.parseFailures === 0 ? "ok" as const
        : row.parseFailures <= 2 ? "some" as const
          : "many" as const,
    }))
    .sort((a, b) => `${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`));
}

export function advisorCacheHash(input: {
  catalog: AdvisorCatalogModel[];
  budgetMode: BudgetMode;
  language: string;
  health: AdvisorHealthBucket[];
}): string {
  const catalogKey = input.catalog
    .map((row) => `${row.provider}|${row.model}|${row.vision ? 1 : 0}|${row.subscription ? 1 : 0}`)
    .sort();
  return createHash("sha256").update(JSON.stringify({
    catalog: catalogKey,
    budgetMode: input.budgetMode,
    language: input.language,
    health: healthBucketsForCache(input.health),
  })).digest("hex");
}

export function buildAdvisorTaskInputs(): AdvisorTaskInput[] {
  return LLM_TASKS.filter((task) => task.id !== "modelAdvisor").map((task) => ({
    id: task.id,
    label: task.label,
    purpose: task.purpose,
    qualityWeight: task.qualityWeight,
    needsVision: task.needsVision === true,
    needsLongContext: task.needsLongContext === true,
    typicalTokens: typicalTokensForTask(task.id, task.qualityWeight),
  }));
}

function typicalTokensForTask(id: LlmTaskId, qualityWeight: 1 | 2 | 3): { input: number; output: number } {
  if (id === "research" || id === "script" || id === "scriptReview" || id === "factCheck" || id === "guidelineCheck" || id === "reviewChat") {
    return { input: 4_000 + qualityWeight * 500, output: 1_500 + qualityWeight * 300 };
  }
  if (id === "visionCheck" || id === "visionConsistency" || id === "renderVision" || id === "thumbnailPick") {
    return { input: 6_000, output: 400 };
  }
  if (id === "sceneQueries" || id === "visualRerank" || id === "metadata") {
    return { input: 2_500, output: 600 };
  }
  return { input: 1_200, output: 300 };
}

export function validateAdvisorRoutes(
  raw: ModelAdvisorOutput,
  catalog: AdvisorCatalogModel[],
  currentRoutes: Partial<Record<LlmTaskId, { provider: string; model: string } | null>>,
): { routes: Partial<Record<LlmTaskId, ModelAdvisorRoutePick>>; notes: string } {
  const usable = catalog.filter((row) => row.provider !== "mock" || catalog.every((item) => item.provider === "mock"));
  const onlyMock = usable.length > 0 && usable.every((row) => row.provider === "mock");
  const allowed = new Map(usable.map((row) => [`${row.provider}:${row.model}`, row]));
  const visionProviders = new Set(usable.filter((row) => row.vision).map((row) => `${row.provider}:${row.model}`));
  const tasks = buildAdvisorTaskInputs();
  const routes: Partial<Record<LlmTaskId, ModelAdvisorRoutePick>> = {};

  for (const task of tasks) {
    const pick = raw.routes[task.id];
    const current = currentRoutes[task.id];
    const fallback: ModelAdvisorRoutePick = current
      ? { provider: current.provider, model: current.model, reason: KEEP_REASON }
      : firstCatalogPick(usable, task.needsVision) ?? {
        provider: "mock",
        model: "mock-v1",
        reason: KEEP_REASON,
      };

    if (!pick) {
      routes[task.id] = fallback;
      continue;
    }

    const key = `${pick.provider}:${pick.model}`;
    const catalogRow = allowed.get(key);
    const providerOk = Boolean(catalogRow) && (onlyMock || pick.provider !== "mock");
    const visionOk = !task.needsVision || Boolean(catalogRow?.vision) || visionProviders.has(key);

    if (!providerOk || !visionOk) {
      routes[task.id] = {
        provider: fallback.provider,
        model: fallback.model,
        reason: KEEP_REASON,
      };
      continue;
    }

    routes[task.id] = {
      provider: pick.provider,
      model: pick.model,
      reason: pick.reason.trim() || "Đề xuất từ advisor.",
    };
  }

  return { routes, notes: raw.notes };
}

function firstCatalogPick(
  catalog: AdvisorCatalogModel[],
  needsVision: boolean,
): ModelAdvisorRoutePick | undefined {
  const row = catalog.find((item) => !needsVision || item.vision) ?? catalog[0];
  if (!row) return undefined;
  return {
    provider: row.provider,
    model: row.model,
    reason: KEEP_REASON,
  };
}

function loadProposalStore(sqlite: Database.Database): CachedProposalStore {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(PROPOSAL_CACHE_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { entries: {} };
  try {
    const parsed = JSON.parse(row.value) as CachedProposalStore;
    return { entries: parsed.entries ?? {} };
  } catch {
    return { entries: {} };
  }
}

function saveProposalStore(sqlite: Database.Database, store: CachedProposalStore): void {
  sqlite.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(PROPOSAL_CACHE_KEY, JSON.stringify(store), new Date().toISOString());
}

export function getCachedProposal(
  sqlite: Database.Database,
  hash: string,
  now = Date.now(),
): ModelAdvisorProposal | undefined {
  const store = loadProposalStore(sqlite);
  const entry = store.entries[hash];
  if (!entry) return undefined;
  if (Date.parse(entry.createdAt) + PROPOSAL_TTL_MS < now) {
    delete store.entries[hash];
    saveProposalStore(sqlite, store);
    return undefined;
  }
  return { ...entry.proposal, cached: true };
}

export function putCachedProposal(
  sqlite: Database.Database,
  hash: string,
  proposal: ModelAdvisorProposal,
): void {
  const store = loadProposalStore(sqlite);
  const now = Date.now();
  for (const [key, entry] of Object.entries(store.entries)) {
    if (Date.parse(entry.createdAt) + PROPOSAL_TTL_MS < now) delete store.entries[key];
  }
  store.entries[hash] = { createdAt: proposal.createdAt, proposal: { ...proposal, cached: false } };
  saveProposalStore(sqlite, store);
}

export function getStoredProposalById(
  sqlite: Database.Database,
  proposalId: string,
): ModelAdvisorProposal | undefined {
  const store = loadProposalStore(sqlite);
  for (const entry of Object.values(store.entries)) {
    if (entry.proposal.proposalId === proposalId) return entry.proposal;
  }
  return undefined;
}

function stubProject(llm?: LlmSettings): Project {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000000",
    title: "advisor",
    description: "",
    topic: "advisor",
    mode: "ASSISTED",
    settings: {
      language: "vi",
      targetDurationSec: 120,
      wordsPerMinute: 150,
      aspectRatio: "16:9",
      platform: "youtube",
      style: "documentary",
      tone: "neutral",
      audience: "general",
      visualStyle: "photo",
      sceneDurationSec: 6,
      budget: { mode: "BALANCED" },
      subtitles: { enabled: true, maxCharsPerLine: 42 },
      music: { enabled: true, volume: 0.2 },
      userSet: [],
      stageExecutors: {},
      autoRender: false,
      guidelines: { platformPack: "auto", customRules: [] },
      ...(llm ? { llm } : {}),
    },
    status: "DRAFT",
    stage: "RESEARCH",
    thumbnailPath: null,
    durationSec: null,
    version: 1,
    profileId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function buildDiff(
  tasks: AdvisorTaskInput[],
  current: Partial<Record<LlmTaskId, { provider: string; model: string } | null>>,
  proposed: Partial<Record<LlmTaskId, ModelAdvisorRoutePick>>,
): ModelAdvisorDiffEntry[] {
  return tasks.map((task) => {
    const cur = current[task.id] ?? null;
    const prop = proposed[task.id]!;
    const changed = !cur
      || cur.provider !== prop.provider
      || cur.model !== prop.model;
    return {
      taskId: task.id,
      current: cur,
      proposed: prop,
      changed,
    };
  });
}

function currentRoutesForScope(
  registry: LlmProviderRegistry,
  sqlite: Database.Database,
  scope: ModelAdvisorScope,
  project: Project | undefined,
  profileLlm: ProfileLlmSettings | null | undefined,
): Partial<Record<LlmTaskId, { provider: string; model: string } | null>> {
  const appRouting = getAppLlmSettings(sqlite);
  const routes: Partial<Record<LlmTaskId, { provider: string; model: string } | null>> = {};
  const tasks = buildAdvisorTaskInputs();

  if (scope === "profile") {
    for (const task of tasks) {
      const route = profileLlm?.tasks?.[task.id] ?? profileLlm?.default;
      routes[task.id] = route
        ? { provider: route.provider, model: route.model ?? "" }
        : null;
    }
    return routes;
  }

  const target = project ?? stubProject();
  for (const task of tasks) {
    try {
      const resolved = registry.resolveRoute(task.id, target, appRouting);
      routes[task.id] = { provider: resolved.provider, model: resolved.model };
    } catch {
      routes[task.id] = null;
    }
  }
  return routes;
}

export async function proposeModelRoutes(input: {
  registry: LlmProviderRegistry;
  sqlite: Database.Database;
  projects?: ProjectService;
  profiles?: ProfileService;
  scope: ModelAdvisorScope;
  id?: string;
  budgetMode?: BudgetMode;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<ModelAdvisorProposal> {
  const now = input.now ?? new Date();
  if ((input.scope === "profile" || input.scope === "project") && !input.id) {
    throw new AppError(400, "INVALID_ADVISOR_SCOPE", "id is required for profile/project scope");
  }

  let project: Project | undefined;
  let profileLlm: ProfileLlmSettings | null | undefined;
  let language = "vi";
  let budgetMode: BudgetMode = input.budgetMode ?? "BALANCED";

  if (input.scope === "project") {
    project = await input.projects?.getProject(input.id!);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    language = project.settings.language;
    budgetMode = input.budgetMode ?? project.settings.budget?.mode ?? "BALANCED";
  } else if (input.scope === "profile") {
    const profile = await input.profiles?.getProfile(input.id!);
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found");
    language = profile.language;
    profileLlm = profile.llm;
    budgetMode = input.budgetMode ?? profile.defaultBrief.budget?.mode ?? "BALANCED";
  }

  const providers = input.registry.list();
  const modelLists: Record<string, string[]> = {};
  for (const info of providers) {
    if (!info.configured) continue;
    try {
      modelLists[info.id] = await input.registry.suggestModels(info.id, input.fetchImpl ?? fetch);
    } catch {
      modelLists[info.id] = info.defaultModel ? [info.defaultModel] : [];
    }
  }

  const catalog = buildAdvisorCatalog(input.registry, modelLists);
  if (catalog.length === 0) {
    throw new AppError(400, "NO_LLM_PROVIDERS", "Không có nhà cung cấp LLM nào được cấu hình.");
  }
  const health = buildAdvisorHealth(input.sqlite, now);
  const hash = advisorCacheHash({ catalog, budgetMode, language, health });
  const cached = getCachedProposal(input.sqlite, hash, now.getTime());
  if (cached) {
    return ModelAdvisorProposalSchema.parse({
      ...cached,
      scope: input.scope,
      ...(input.id ? { id: input.id } : {}),
      budgetMode,
      language,
      cached: true,
    });
  }

  const tasks = buildAdvisorTaskInputs();
  const current = currentRoutesForScope(input.registry, input.sqlite, input.scope, project, profileLlm);
  const appRouting = getAppLlmSettings(input.sqlite);
  const routeProject = stubProject();
  const route = input.registry.resolveTask("modelAdvisor", routeProject, appRouting);
  const cache = new LlmCache(input.sqlite, true);

  const promptPayload = {
    budgetMode,
    language,
    catalog,
    health,
    tasks,
    currentRoutes: current,
  };

  const generated = await generateRoutedStructured({
    registry: input.registry,
    route,
    task: "modelAdvisor",
    system: [
      "You are an LLM model advisor for a video generation app.",
      "Pick one provider+model from the catalog for each task.",
      "Respect budgetMode: ECO prefers cheap/subscription/fast; QUALITY/MAX prefer higher qualityWeight.",
      "Vision tasks must use vision-capable models.",
      "reason must be one short Vietnamese sentence.",
      "Never invent providers or models outside the catalog.",
      "Reply with JSON only.",
    ].join(" "),
    prompt: JSON.stringify(promptPayload),
    schema: ModelAdvisorOutputSchema,
    schemaName: "ModelAdvisor",
    schemaVersion: "1",
    maxOutputTokens: route.maxOutputTokens ?? 4_096,
    signal: input.signal ?? new AbortController().signal,
    cache,
    cacheKeyExtra: hash,
  });

  const validated = validateAdvisorRoutes(generated.value, catalog, current);
  const proposalId = randomUUID();
  const createdAt = now.toISOString();
  const proposal = ModelAdvisorProposalSchema.parse({
    proposalId,
    scope: input.scope,
    ...(input.id ? { id: input.id } : {}),
    budgetMode,
    language,
    routes: validated.routes,
    notes: validated.notes,
    diff: buildDiff(tasks, current, validated.routes),
    cached: false,
    createdAt,
  });
  putCachedProposal(input.sqlite, hash, proposal);
  // Also index by proposalId for apply (hash entry already stores full proposal).
  return proposal;
}

export async function applyModelRoutes(input: {
  registry: LlmProviderRegistry;
  sqlite: Database.Database;
  projects?: ProjectService;
  profiles?: ProfileService;
  scope: ModelAdvisorScope;
  id?: string;
  proposalId: string;
  taskIds?: LlmTaskId[];
}): Promise<{ scope: ModelAdvisorScope; id?: string; applied: LlmTaskId[]; llm: LlmSettings | ProfileLlmSettings }> {
  if ((input.scope === "profile" || input.scope === "project") && !input.id) {
    throw new AppError(400, "INVALID_ADVISOR_SCOPE", "id is required for profile/project scope");
  }
  const proposal = getStoredProposalById(input.sqlite, input.proposalId);
  if (!proposal) {
    throw new AppError(404, "ADVISOR_PROPOSAL_NOT_FOUND", "Proposal not found or expired");
  }

  const selected = (input.taskIds?.length
    ? input.taskIds
    : (Object.keys(proposal.routes) as LlmTaskId[])
  ).filter((taskId) => proposal.routes[taskId]);

  for (const taskId of selected) {
    const route = proposal.routes[taskId]!;
    if (!input.registry.isSupportedProvider(route.provider)) {
      throw new AppError(400, "INVALID_LLM_PROVIDER", `Unsupported provider: ${route.provider}`);
    }
  }

  const taskRoutes = Object.fromEntries(
    selected.map((taskId) => {
      const pick = proposal.routes[taskId]!;
      return [taskId, { provider: pick.provider, model: pick.model }];
    }),
  );

  if (input.scope === "app") {
    const current = getAppLlmSettings(input.sqlite) ?? {};
    const next: LlmSettings = {
      ...current,
      tasks: { ...current.tasks, ...taskRoutes },
    };
    saveAppLlmSettings(input.sqlite, next);
    return { scope: "app", applied: selected, llm: next };
  }

  if (input.scope === "profile") {
    const profile = await input.profiles?.getProfile(input.id!);
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found");
    const current = profile.llm ?? { autoModel: true };
    const next: ProfileLlmSettings = {
      ...current,
      autoModel: current.autoModel ?? true,
      tasks: { ...current.tasks, ...taskRoutes },
    };
    await input.profiles!.updateProfile(input.id!, { llm: next });
    return { scope: "profile", id: input.id, applied: selected, llm: next };
  }

  const project = await input.projects?.getProject(input.id!);
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  const current = project.settings.llm ?? {};
  const next: LlmSettings = {
    ...current,
    tasks: { ...current.tasks, ...taskRoutes },
  };
  await input.projects!.updateProject(input.id!, { settings: { llm: next } });
  return { scope: "project", id: input.id, applied: selected, llm: next };
}
