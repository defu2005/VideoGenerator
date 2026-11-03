import Database from "better-sqlite3";
import {
  JobStatusSchema,
  JobUsageSchema,
  PipelineStageSchema,
  ProjectUsageSchema,
  UsageTotalsSchema,
  type AppUsage,
  type JobUsage,
  type ProjectUsage,
  type ProjectUsageRun,
  type UsageBucket,
  type UsageCallSummary,
  type UsageQuery,
  type UsageTotals,
} from "@vg/shared";

type UsageJobRow = {
  id: string;
  project_id: string;
  project_title: string;
  stage: string;
  scope: string | null;
  status: string;
  attempt: number;
  usage: string | JobUsage;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const SUBSCRIPTION_PROVIDERS = new Set(["claude-cli", "copilot-cli", "antigravity-cli"]);

function emptyTotals(): UsageTotals {
  return {
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedCalls: 0,
    fallbackCalls: 0,
    failedCalls: 0,
    premiumRequests: 0,
    tokensUnknown: false,
    costUsd: 0,
  };
}

function addTotals(target: UsageTotals, value: UsageTotals): void {
  target.llmCalls += value.llmCalls;
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cachedCalls += value.cachedCalls;
  target.fallbackCalls += value.fallbackCalls;
  target.failedCalls += value.failedCalls;
  target.premiumRequests += value.premiumRequests;
  target.tokensUnknown ||= value.tokensUnknown;
  target.costUsd += value.costUsd;
}

function createBucket(key: string, label = key): UsageBucket {
  return { key, label, ...emptyTotals() };
}

function callTotals(call: UsageCallSummary): UsageTotals {
  const count = call.callCount;
  return {
    llmCalls: call.cached ? 0 : count,
    inputTokens: call.cached ? 0 : call.inputTokens,
    outputTokens: call.cached ? 0 : call.outputTokens,
    cachedCalls: call.cached ? count : 0,
    fallbackCalls: call.fallback ? count : 0,
    failedCalls: call.ok ? 0 : count,
    premiumRequests: call.premiumRequests,
    tokensUnknown: call.tokensUnknown,
    costUsd: call.costUsd,
  };
}

function usageForJob(job: UsageJobRow): ProjectUsageRun | undefined {
  // Old or hand-edited rows can hold usage this version cannot read; skip them instead of failing the page.
  let raw: unknown;
  try {
    raw = typeof job.usage === "string" ? JSON.parse(job.usage) as unknown : job.usage;
  } catch {
    return undefined;
  }
  const parsedUsage = JobUsageSchema.safeParse(raw);
  const parsedStatus = JobStatusSchema.safeParse(job.status);
  const parsedStage = PipelineStageSchema.safeParse(job.stage);
  if (!parsedUsage.success || !parsedStatus.success || !parsedStage.success) return undefined;
  const usage = parsedUsage.data;
  const status = parsedStatus.data;
  const stage = parsedStage.data;
  const billableCallCount = usage.calls?.reduce(
    (sum, call) => sum + (!call.cached && !SUBSCRIPTION_PROVIDERS.has(call.provider) ? 1 : 0),
    0,
  ) ?? 0;
  const hasCallDetails = (usage.calls?.length ?? 0) > 0;
  const calls: UsageCallSummary[] = hasCallDetails
    ? usage.calls!.map((call) => ({
      ...call,
      premiumRequests: call.premiumRequests ?? 0,
      callCount: 1,
      // The job-level flag only says some call lacked counts: blame calls that reported none.
      tokensUnknown: (usage.tokensUnknown ?? false) && !call.cached
        && call.inputTokens === 0 && call.outputTokens === 0,
      costUsd: call.cached || SUBSCRIPTION_PROVIDERS.has(call.provider) || billableCallCount === 0
        ? 0
        : usage.costUsd / billableCallCount,
    }))
    : usage.llmCalls > 0 || usage.inputTokens > 0 || usage.outputTokens > 0 || usage.costUsd > 0 || usage.tokensUnknown
      ? [{
        task: stage,
        provider: usage.provider ?? "unknown",
        model: usage.model ?? "unknown",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        premiumRequests: 0,
        callCount: usage.llmCalls,
        cached: false,
        fallback: false,
        ok: status === "SUCCEEDED",
        tokensUnknown: usage.tokensUnknown ?? false,
        costUsd: SUBSCRIPTION_PROVIDERS.has(usage.provider ?? "") ? 0 : usage.costUsd,
      }]
      : [];
  if (calls.length === 0) return undefined;

  const totals = emptyTotals();
  for (const call of calls) addTotals(totals, callTotals(call));
  if (!hasCallDetails) {
    totals.tokensUnknown = usage.tokensUnknown ?? false;
  }
  const durationMs = job.started_at && job.finished_at
    ? Math.max(0, Date.parse(job.finished_at) - Date.parse(job.started_at))
    : null;
  return {
    jobId: job.id,
    stage,
    scope: job.scope,
    attempt: job.attempt,
    status,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    durationMs,
    tokens: {
      input: totals.inputTokens,
      output: totals.outputTokens,
      unknown: totals.tokensUnknown,
    },
    totals: UsageTotalsSchema.parse(totals),
    calls,
  };
}

function getBucket(map: Map<string, UsageBucket>, key: string, label = key): UsageBucket {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = createBucket(key, label);
    map.set(key, bucket);
  }
  return bucket;
}

function getJobRows(
  sqlite: Database.Database,
  projectId?: string,
  range?: Pick<UsageQuery, "from" | "to">,
): UsageJobRow[] {
  const clauses = ["j.usage IS NOT NULL"];
  const bindings: (string | number)[] = [];
  if (projectId) {
    clauses.push("j.project_id = ?");
    bindings.push(projectId);
  }
  if (range?.from) {
    clauses.push("substr(COALESCE(j.started_at, j.created_at), 1, 10) >= ?");
    bindings.push(range.from);
  }
  if (range?.to) {
    clauses.push("substr(COALESCE(j.started_at, j.created_at), 1, 10) <= ?");
    bindings.push(range.to);
  }
  return sqlite.prepare(`
    SELECT j.id, j.project_id, p.title AS project_title, j.stage, j.scope,
      j.status, j.attempt, j.usage, j.created_at, j.started_at, j.finished_at
    FROM jobs j JOIN projects p ON p.id = j.project_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY COALESCE(j.started_at, j.created_at), j.rowid
  `).all(...bindings) as UsageJobRow[];
}

export class UsageService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly usdVndRate: number,
  ) {}

  getProjectUsage(projectId: string): ProjectUsage {
    const totals = emptyTotals();
    const stages = new Map<string, UsageBucket>();
    const tasks = new Map<string, UsageBucket>();
    const models = new Map<string, UsageBucket>();
    const runs: ProjectUsageRun[] = [];
    for (const job of getJobRows(this.sqlite, projectId)) {
      const run = usageForJob(job);
      if (!run) continue;
      runs.push(run);
      addTotals(totals, run.totals);
      const stageBucket = getBucket(stages, run.stage, run.stage.replaceAll("_", " "));
      addTotals(stageBucket, run.totals);
      for (const call of run.calls) {
        addTotals(getBucket(tasks, call.task), callTotals(call));
        addTotals(getBucket(models, `${call.provider}/${call.model}`, `${call.provider} · ${call.model}`), callTotals(call));
      }
    }
    return ProjectUsageSchema.parse({
      projectId,
      usdVndRate: this.usdVndRate,
      totals,
      byStage: [...stages.values()].sort((a, b) => b.llmCalls - a.llmCalls || a.label.localeCompare(b.label)),
      byTask: [...tasks.values()].sort((a, b) => b.llmCalls - a.llmCalls || a.label.localeCompare(b.label)),
      byModel: [...models.values()].sort((a, b) => b.llmCalls - a.llmCalls || a.label.localeCompare(b.label)),
      runs: runs.reverse(),
    });
  }

  getAppUsage(query: UsageQuery): AppUsage {
    const totals = emptyTotals();
    const groups = new Map<string, UsageBucket>();
    const projectTotals = new Map<string, { title: string; totals: UsageTotals }>();
    for (const job of getJobRows(this.sqlite, undefined, query)) {
      const run = usageForJob(job);
      if (!run) continue;
      addTotals(totals, run.totals);
      let project = projectTotals.get(job.project_id);
      if (!project) {
        project = { title: job.project_title, totals: emptyTotals() };
        projectTotals.set(job.project_id, project);
      }
      addTotals(project.totals, run.totals);

      for (const call of run.calls) {
        const key = query.groupBy === "day"
          ? (job.started_at ?? job.created_at).slice(0, 10)
          : query.groupBy === "provider"
            ? call.provider
            : query.groupBy === "model"
              ? `${call.provider}/${call.model}`
              : job.project_id;
        const label = query.groupBy === "project"
          ? job.project_title
          : query.groupBy === "model"
            ? `${call.provider} · ${call.model}`
            : key;
        addTotals(getBucket(groups, key, label), callTotals(call));
      }
    }
    return {
      from: query.from ?? null,
      to: query.to ?? null,
      groupBy: query.groupBy,
      usdVndRate: this.usdVndRate,
      totals,
      byGroup: [...groups.values()].sort((a, b) => {
        if (query.groupBy === "day") return a.key.localeCompare(b.key);
        return b.llmCalls - a.llmCalls || a.label.localeCompare(b.label);
      }),
      topProjects: [...projectTotals.entries()]
        .map(([projectId, project]) => ({ projectId, projectTitle: project.title, totals: project.totals }))
        .sort((a, b) => (b.totals.inputTokens + b.totals.outputTokens) - (a.totals.inputTokens + a.totals.outputTokens))
        .slice(0, 10),
    };
  }
}
