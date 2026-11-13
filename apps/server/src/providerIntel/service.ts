import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ChangeInbox } from "../knowledge/changeInbox.js";
import { fetchOfficialPage } from "../knowledge/officialPage.js";
import {
  DEFAULT_DISCOVERY_FEEDS,
  NEEDS_TOKEN_STEPS_VI,
  OfferSchema,
  PROTECTED_PROJECT_ID,
  PROVIDER_STUBS,
  ProviderDocumentSchema,
  ProviderStubSchema,
  ROUTING_PROFILES,
  acceptExtractedFields,
  aggregateModelTaskStats,
  blankProvider,
  containsProtectedProject,
  decideEvalRun,
  estimateEvalCalls,
  getPath,
  gradeCase,
  hostAllowed,
  isUserChecked,
  knownEvidence,
  LLM_TASKS,
  discoverCandidates,
  listEvalSuites,
  modelScorecard,
  overviewQuestions,
  providerSlug,
  partitionOffers,
  quoteInPage,
  recommendProfile,
  recomputeProvider,
  redactExportText,
  robotsDisallows,
  setPath,
  unknownEvidence,
  type EvalModelGuard,
  type ProviderDocument,
  type ProviderOffer,
  type ProviderRecord,
  type ProviderStub,
  type TaskStatCall,
  type TaskStatSignal,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { getOperatorSettings } from "../operator/settings.js";
import { OMNIROUTE_MANAGEMENT_TOKEN_KEY } from "../providers/llm/omnirouteQuotaStore.js";
import { writeIntelExport, writeReportFile } from "./exportFiles.js";
import { auditOmniRoute, runModelProbe, updateOmnirouteCombos, INTEL_USER_AGENT, type FetchLike } from "./omniroute.js";
import { IntelStore } from "./store.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FEEDS_KEY = "providerIntel.feeds";
const JOBS_KEY = "providerIntel.jobs";
const APPLIED_KEY = "providerIntel.appliedRoutes";
const MAX_CALLS_KEY = "providerIntel.maxCallsPerRun";
const MUTE_KEY = "providerIntel.telegramMute";
const RESEARCH_ORDER_ID = "intel-full-research";

type Logger = { info?: (obj: unknown, msg?: string) => void; warn?: (obj: unknown, msg?: string) => void };

export type IntelDeps = {
  sqlite: Database.Database;
  now?: () => Date;
  fetchImpl?: FetchLike;
  logger?: Logger;
  exportRoot: string;
  vault?: { loadSecret(key: string): string | null };
  omnirouteOrigin?: string;
  omnirouteApiKey?: string | null;
  wake?: (reason: string, prompt: string) => { status: string };
  notify?: (event: { kind: "automation_warning"; profile: string; message: string }) => void | Promise<void>;
  createPending?: (tool: string, args: unknown, summary: string) => { id: string; summary: string };
  extractPageText?: (pageText: string) => Promise<Array<{ path: string; value: string; quote: string }>>;
  allowAutoExtract?: boolean;
};

type PageRow = {
  id: string;
  url: string;
  providerId: string;
  pageKind: string;
  contentHash: string;
  bodyText: string;
  lastFetchedAt: string;
  lastChangedAt: string;
  status: string;
};

export class ProviderIntelService {
  readonly store: IntelStore;
  private nowFn: () => Date;
  private fetchFn: FetchLike;
  private wakeFn: IntelDeps["wake"];
  private extractFn: IntelDeps["extractPageText"];
  private allowAutoExtract: boolean;

  constructor(private readonly deps: IntelDeps) {
    this.nowFn = deps.now ?? (() => new Date());
    this.fetchFn = deps.fetchImpl ?? fetch;
    this.wakeFn = deps.wake;
    this.extractFn = deps.extractPageText;
    this.allowAutoExtract = deps.allowAutoExtract === true;
    this.store = new IntelStore(deps.sqlite, () => this.nowFn());
    this.ensureSeeds();
  }

  setNow(now: () => Date): void {
    this.nowFn = now;
  }

  setFetch(fetchImpl: FetchLike): void {
    this.fetchFn = fetchImpl;
  }

  setWake(wake: IntelDeps["wake"]): void {
    this.wakeFn = wake;
  }

  setNotify(notify: IntelDeps["notify"]): void {
    this.deps.notify = notify;
  }

  setLogger(logger: Logger): void {
    this.deps.logger = logger;
  }

  setExtract(extract: IntelDeps["extractPageText"]): void {
    this.extractFn = extract;
    this.allowAutoExtract = true;
  }

  startScheduler(): () => void {
    const timer = setInterval(() => {
      if (process.env.VITEST) return;
      void this.runDueJobs().catch((error: unknown) => {
        this.deps.logger?.warn?.({ name: error instanceof Error ? error.name : "Error" }, "provider intel job failed");
      });
    }, 60 * 60 * 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  summary() {
    const providers = this.providers();
    const offers = this.allOffers();
    const split = partitionOffers(offers, this.nowFn());
    const connections = this.latestAudit();
    return {
      overview: overviewQuestions({
        registered: providers.length,
        callable: connections?.connections.filter((item) => item.states.includes("CALLABLE")).length ?? 0,
        freeQuota: split.active.filter((offer) => offer.kind !== "chatbot_only_not_api" && offer.appliesTo === "api_inference").length,
        unusedBenefits: 0,
        cloudExtras: 0,
        vietnamOk: providers.filter((item) => item.vietnam === true).length,
        cardOrKyc: providers.filter((item) => item.cardRequired === true).length,
        expiringSoon: split.expiring.length,
        usefulForProjects: 0,
        safeToActivate: providers.filter((item) => item.autoConfigAllowed && item.riskLevel === "LOW").length,
      }),
      providerCount: providers.length,
      needsResearch: providers.filter((item) => item.needsResearch).length,
      unverified: providers.filter((item) => item.flags.includes("BILLING_UNVERIFIED")).length,
    };
  }

  page() {
    const offers = this.allOffers();
    const split = partitionOffers(offers, this.nowFn());
    return {
      overview: this.summary().overview,
      providers: this.providers(),
      connections: this.latestAudit(),
      offers: { active: split.active, expired: split.expired, expiring: split.expiring },
      billing: this.providers().map((item) => ({
        providerId: item.id,
        name: item.name,
        riskLevel: item.riskLevel,
        unverified: item.flags.includes("BILLING_UNVERIFIED"),
        flags: item.flags,
        autoConfigAllowed: item.autoConfigAllowed,
        safestVi: item.safestVi,
      })),
      changes: this.listChanges(),
      profiles: ROUTING_PROFILES,
      proposals: this.store.list("proposal").map((row) => row.body),
      feeds: this.feeds(),
      suites: listEvalSuites().map((suite) => ({ id: suite.id, titleVi: suite.titleVi, taskId: suite.taskId, cases: suite.cases.length })),
      tasks: LLM_TASKS.map((task) => ({ id: task.id, label: task.label })),
      scorecard: this.scorecard("metadata", "BALANCED"),
      needsTokenStepsVi: NEEDS_TOKEN_STEPS_VI,
    };
  }

  getProvider(id: string): ProviderDocument {
    return this.document(id);
  }

  feeds(): Array<{ url: string; label: string }> {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(FEEDS_KEY) as { value: string } | undefined;
    if (!row) return DEFAULT_DISCOVERY_FEEDS.map((item) => ({ ...item }));
    const parsed = JSON.parse(row.value) as Array<{ url: string; label: string }>;
    return Array.isArray(parsed) ? parsed : DEFAULT_DISCOVERY_FEEDS.map((item) => ({ ...item }));
  }

  saveFeeds(feeds: Array<{ url: string; label: string }>): Array<{ url: string; label: string }> {
    const clean = feeds.map((item) => ({ url: item.url, label: item.label })).slice(0, 20);
    this.setting(FEEDS_KEY, JSON.stringify(clean));
    return clean;
  }

  async fetchPage(providerId: string, url: string, pageKind: string): Promise<{ id: string; hash: string; changed: boolean; text: string }> {
    const doc = this.document(providerId);
    const website = doc.website;
    if (!hostAllowed(website, url)) {
      throw new AppError(400, "UNOFFICIAL_PAGE", "Chỉ lấy trang chính thức của nhà cung cấp.");
    }
    const existing = this.pageByUrl(url);
    if (existing && this.nowFn().getTime() - Date.parse(existing.lastFetchedAt) < SIX_HOURS_MS) {
      throw new AppError(429, "PAGE_FRESH", "Trang này đã lấy trong 6 giờ qua.");
    }
    const response = await fetchOfficialPage(url, this.fetchFn, INTEL_USER_AGENT);
    const text = response.text;
    const hash = createHash("sha256").update(text).digest("hex");
    const changed = Boolean(existing && existing.contentHash !== hash);
    const at = this.nowFn().toISOString();
    const id = existing?.id ?? randomUUID();
    if (existing) {
      this.deps.sqlite.prepare(
        `UPDATE provider_intel_pages
         SET content_hash = ?, body_text = ?, last_fetched_at = ?, last_changed_at = ?, status = ?, page_kind = ?
         WHERE id = ?`,
      ).run(hash, text, at, changed ? at : existing.lastChangedAt, response.ok ? "ok" : "error", pageKind, id);
    } else {
      this.deps.sqlite.prepare(
        `INSERT INTO provider_intel_pages
         (id, url, provider_id, page_kind, content_hash, body_text, last_fetched_at, last_changed_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, url, providerId, pageKind, hash, text, at, at, response.ok ? "ok" : "error");
    }
    this.deps.logger?.info?.({ url, status: response.status, bytes: text.length }, "provider page fetched");
    if (changed) {
      this.addChange(providerId, `Trang ${pageKind}`, "Nội dung cũ", "Nội dung đã đổi", true);
      await this.notify(`Trang ${url} đã đổi và cần xem lại.`);
    }
    return { id, hash, changed, text };
  }

  submitAssessment(input: { providerId: string; pageId: string; fields: Array<{ path: string; value: string; quote: string }> }) {
    const page = this.pageById(input.pageId);
    const judged = acceptExtractedFields(page.bodyText, input.fields);
    const record = this.asRecord(input.providerId);
    const skipped: string[] = [];
    for (const field of judged.accepted) {
      if (isUserChecked(getPath(record, field.path))) {
        skipped.push(field.path);
        continue;
      }
      setPath(record as unknown as Record<string, unknown>, field.path, knownEvidence(field.value, page.url, this.nowFn().toISOString(), "public_docs", field.quote));
    }
    record.needsResearch = false;
    let saved: ReturnType<IntelStore["append"]>;
    try {
      saved = this.saveRecord(record);
    } catch (error) {
      this.deps.logger?.warn?.({ name: error instanceof Error ? error.name : "Error" }, "provider assessment rejected");
      return {
        version: 0,
        accepted: [] as string[],
        rejected: input.fields.map((field) => field.path),
        skipped,
      };
    }
    if (saved.body && typeof saved.body === "object" && Array.isArray((saved.body as ProviderRecord).flags)) {
      const flags = (saved.body as ProviderRecord).flags;
      if (flags.includes("BILLING_UNVERIFIED") || (saved.body as ProviderRecord).billing.riskLevel === "HIGH" || (saved.body as ProviderRecord).billing.riskLevel === "CRITICAL") {
        void this.notify(`Rủi ro thanh toán của ${input.providerId} cần xem. Cờ: ${flags.join(", ")}`);
      }
    }
    return {
      version: saved.version,
      accepted: judged.accepted.map((field) => field.path).filter((path) => !skipped.includes(path)),
      rejected: judged.rejected.map((field) => field.path),
      skipped,
    };
  }

  setChecklist(providerId: string, path: string, value: boolean | string) {
    const record = this.asRecord(providerId);
    const current = getPath(record, path) as { value?: unknown } | undefined;
    const stored = typeof value === "boolean"
      && current
      && (current.value === "yes" || current.value === "no" || current.value === "UNKNOWN")
      ? (value ? "yes" : "no")
      : value;
    setPath(
      record as unknown as Record<string, unknown>,
      path,
      knownEvidence(stored, "app://user-checklist", this.nowFn().toISOString(), "user_checked"),
    );
    const saved = this.saveRecord(record);
    return { version: saved.version, provider: saved.body };
  }

  setOffer(input: {
    providerId: string;
    id: string;
    kind: ProviderOffer["kind"];
    unit: ProviderOffer["unit"];
    appliesTo: ProviderOffer["appliesTo"];
    status: ProviderOffer["status"];
    expiresAt: string | null;
    pageId: string;
    quote: string;
    amount: number;
  }) {
    const page = this.pageById(input.pageId);
    const quoted = quoteInPage(page.bodyText, input.quote);
    const offer = OfferSchema.parse({
      id: input.id,
      providerId: input.providerId,
      kind: input.kind,
      amount: quoted
        ? knownEvidence(input.amount, page.url, this.nowFn().toISOString(), "public_docs", input.quote)
        : unknownEvidence<number>(),
      unit: input.unit,
      rpm: unknownEvidence<number>(),
      tpm: unknownEvidence<number>(),
      rpd: unknownEvidence<number>(),
      context: unknownEvidence<number>(),
      models: [],
      expiresAt: input.expiresAt,
      requirements: [],
      appliesTo: input.appliesTo,
      status: quoted ? input.status : "unverified",
    });
    const saved = this.store.append("offer", `${input.providerId}:${input.id}`, offer);
    this.saveRecord(this.asRecord(input.providerId));
    return { version: saved.version, offer, quoteAccepted: quoted };
  }

  async extractStoredPage(pageId: string) {
    if (!this.extractFn) return { accepted: [] as string[], rejected: [] as string[], skipped: [] as string[], reason: "off" };
    const page = this.pageById(pageId);
    const fields = await this.extractFn(page.bodyText);
    return this.submitAssessment({ providerId: page.providerId, pageId, fields });
  }

  addStub(input: { id: string; name: string; website: string; categories: ProviderStub["categories"]; discoveredFrom?: string }) {
    const stub = ProviderStubSchema.parse({ ...input, needsResearch: true });
    if (this.store.current("provider", stub.id)) {
      throw new AppError(409, "PROVIDER_EXISTS", "Nhà cung cấp đã có trong danh mục.");
    }
    this.store.append("provider", stub.id, stub);
    this.enqueue(stub.id);
    return stub;
  }

  expireOffers(): ProviderOffer[] {
    const moved: ProviderOffer[] = [];
    for (const row of this.store.list("offer")) {
      const offer = OfferSchema.parse(row.body);
      const split = partitionOffers([offer], this.nowFn());
      if (!split.moved.length) continue;
      const next = split.moved[0]!;
      this.store.append("offer", row.key, next);
      moved.push(next);
      this.addChange(offer.providerId, "Ưu đãi hết hạn", offer.status, "expired", true);
    }
    return moved;
  }

  async runJob(job: "daily" | "weekly" | "monthly" | "audit" | "probes" | "export") {
    if (job === "daily") return this.runDaily();
    if (job === "weekly") return this.runWeekly();
    if (job === "monthly") return this.runMonthly();
    if (job === "audit") return this.audit();
    if (job === "probes") return this.runProbes();
    return this.exportAll();
  }

  async runDueJobs(): Promise<void> {
    const state = this.jobState();
    const now = this.nowFn();
    const day = now.toISOString().slice(0, 10);
    if (state.daily !== day) await this.runDaily();
    if (now.getUTCDay() === 1 && state.weekly !== day) await this.runWeekly();
    if (now.getUTCDate() === 1 && state.monthly !== day) await this.runMonthly();
  }

  listChanges() {
    const rows = this.deps.sqlite.prepare(
      "SELECT * FROM provider_intel_changes ORDER BY created_at DESC LIMIT 100",
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      providerId: String(row.provider_id),
      what: String(row.what),
      oldSummary: String(row.old_summary),
      newSummary: String(row.new_summary),
      needsReview: row.needs_review === 1,
      reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
      createdAt: String(row.created_at),
    }));
  }

  markChangeReviewed(id: string) {
    const at = this.nowFn().toISOString();
    const result = this.deps.sqlite.prepare(
      "UPDATE provider_intel_changes SET needs_review = 0, reviewed_at = ? WHERE id = ?",
    ).run(at, id);
    if (result.changes === 0) throw new AppError(404, "CHANGE_NOT_FOUND", "Không thấy thay đổi.");
    return { id, reviewedAt: at };
  }

  async audit() {
    const token = this.deps.vault?.loadSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY)?.trim() || null;
    const result = await auditOmniRoute({
      origin: this.deps.omnirouteOrigin ?? "http://127.0.0.1:20128",
      managementToken: token,
      apiKey: this.deps.omnirouteApiKey ?? null,
      fetchImpl: this.fetchFn,
      now: this.nowFn(),
      logger: this.deps.logger,
    });
    this.store.append("audit", "latest", result);
    this.noteUnknownConnections(result.connections);
    return result;
  }

  async updateCombos(profiles: Array<{ id: string; models: string[] }>, retestIds: string[] = []) {
    const token = this.deps.vault?.loadSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY)?.trim();
    if (!token) return { wrote: false, backupId: null, error: "needs_token", regression: false, restoreStepsVi: NEEDS_TOKEN_STEPS_VI };
    const result = await updateOmnirouteCombos({
      origin: this.deps.omnirouteOrigin ?? "http://127.0.0.1:20128",
      token,
      fetchImpl: this.fetchFn,
      profiles,
      retestIds,
    });
    if (result.wrote) {
      const day = this.nowFn().toISOString().slice(0, 10);
      const lines = [
        "# Cập nhật OmniRoute",
        "",
        `Backup: ${result.backupId ?? "không có"}`,
        result.restoreStepsVi ?? "Không có kết nối nào tụt. Không cần khôi phục.",
        "",
        ...profiles.map((profile) => `- va-${profile.id}: ${profile.models.join(", ") || "trống"}`),
        "",
      ];
      writeReportFile(this.deps.exportRoot, `reports/changes/${day}-omniroute.md`, lines.join("\n"));
      this.addChange("omniroute", "Combo OmniRoute", "trước khi ghi", `backup ${result.backupId ?? ""}`, true);
    }
    return result;
  }

  rememberModel(input: { providerId: string; modelId: string; cookie: boolean; paid?: boolean }) {
    this.store.append("model", `${input.providerId}:${input.modelId}`, {
      providerId: input.providerId,
      modelId: input.modelId,
      cookie: input.cookie,
      paid: input.paid === true,
    });
  }

  async runProbes() {
    const origin = this.deps.omnirouteOrigin ?? "http://127.0.0.1:20128";
    const results: Array<{ model: string; skipped: boolean; ok: boolean }> = [];
    for (const row of this.store.list("model")) {
      const model = row.body as { providerId: string; modelId: string; cookie: boolean };
      const last = this.deps.sqlite.prepare(
        "SELECT at FROM provider_intel_probes WHERE provider_id = ? AND model = ? ORDER BY at DESC LIMIT 1",
      ).get(model.providerId, model.modelId) as { at: string } | undefined;
      const probe = await runModelProbe({
        origin,
        apiKey: this.deps.omnirouteApiKey ?? null,
        model: model.modelId,
        fetchImpl: this.fetchFn,
        lastProbeAt: last?.at ?? null,
        now: this.nowFn(),
        cookie: model.cookie,
      });
      results.push({ model: model.modelId, skipped: probe.skipped, ok: probe.ok });
      if (probe.skipped) continue;
      this.deps.sqlite.prepare(
        `INSERT INTO provider_intel_probes (id, provider_id, model, at, ok, latency_ms, error_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), model.providerId, model.modelId, this.nowFn().toISOString(), probe.ok ? 1 : 0, probe.latencyMs, probe.errorKind);
    }
    return results;
  }

  proposeRoute(profileId: string, modelIds: string[]) {
    const profile = ROUTING_PROFILES.find((item) => item.id === profileId);
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Không có hồ sơ định tuyến.");
    const current = this.appliedRoutes()[profileId] ?? [];
    const proposal = {
      id: randomUUID(),
      profileId,
      modelIds,
      diffVi: `Hồ sơ ${profile.titleVi}: ${current.join(", ") || "trống"} -> ${modelIds.join(", ") || "trống"}`,
      createdAt: this.nowFn().toISOString(),
    };
    this.store.append("proposal", proposal.id, proposal);
    return proposal;
  }

  routingProposals() {
    return this.store.list("proposal").map((row) => row.body);
  }

  applyProposal(proposalId: string) {
    const row = this.store.current("proposal", proposalId);
    if (!row || !row.body || typeof row.body !== "object") throw new AppError(404, "PROPOSAL_NOT_FOUND", "Không có đề xuất.");
    const proposal = row.body as { profileId: string; modelIds: string[] };
    const applied = this.appliedRoutes();
    applied[proposal.profileId] = proposal.modelIds;
    this.setting(APPLIED_KEY, JSON.stringify(applied));
    return { applied: true, profileId: proposal.profileId, modelIds: proposal.modelIds };
  }

  recommend(profileId: string) {
    const profile = ROUTING_PROFILES.find((item) => item.id === profileId);
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Không có hồ sơ định tuyến.");
    return recommendProfile(profile, [], { paidFallback: this.paidFallbackEnabled() });
  }

  scorecard(taskId: Parameters<typeof modelScorecard>[0]["taskId"], budgetMode: Parameters<typeof modelScorecard>[0]["budgetMode"]) {
    return modelScorecard({ taskId, budgetMode, paidFallback: this.paidFallbackEnabled(), models: [] });
  }

  modelAbilities(modelId: string) {
    const row = this.store.current("abilities", modelId);
    return row?.body ?? { modelId, abilities: {}, source: "none" };
  }

  nextResearchBatch(limit = 4) {
    const rows = this.deps.sqlite.prepare(
      "SELECT provider_id FROM provider_intel_research_queue WHERE status = 'todo' ORDER BY provider_id ASC LIMIT ?",
    ).all(limit) as Array<{ provider_id: string }>;
    const at = this.nowFn().toISOString();
    for (const row of rows) {
      this.deps.sqlite.prepare(
        "UPDATE provider_intel_research_queue SET status = 'doing', attempts = attempts + 1, last_run_at = ? WHERE provider_id = ?",
      ).run(at, row.provider_id);
    }
    const total = this.queueCount();
    const done = this.queueCount("done");
    const names = rows.map((row) => row.provider_id);
    if (rows.length) void this.notify(`Đã nghiên cứu ${done + rows.length}/${total}: ${names.join(", ")}`);
    return {
      providers: rows.map((row) => this.providers().find((item) => item.id === row.provider_id) ?? { id: row.provider_id }),
    };
  }

  markResearched(providerId: string, status: "done" | "failed" | "todo", note: string, options?: { chain?: boolean }) {
    const at = this.nowFn().toISOString();
    this.deps.sqlite.prepare(
      "UPDATE provider_intel_research_queue SET status = ?, note = ?, last_run_at = ? WHERE provider_id = ?",
    ).run(status, note.slice(0, 500), at, providerId);
    if (options?.chain === false) return { woken: false, reason: "skipped" };
    return this.continueResearch();
  }

  todoCount(): number {
    return this.queueCount("todo");
  }

  continueResearch(): { woken: boolean; reason: string } {
    const order = this.deps.sqlite.prepare("SELECT enabled FROM standing_orders WHERE id = ?").get(RESEARCH_ORDER_ID) as { enabled: number } | undefined;
    if (!order || order.enabled !== 1) return { woken: false, reason: "off" };
    const settings = getOperatorSettings(this.deps.sqlite);
    if (settings.killed) return { woken: false, reason: "killed" };
    if (this.todoCount() === 0) return { woken: false, reason: "empty" };
    const runs = this.runsToday();
    if (runs >= settings.maxRunsPerDay) return { woken: false, reason: "cap" };
    this.wakesToday += 1;
    const result = this.wakeFn?.("Nghiên cứu nhà cung cấp", "Lấy intel_next_research_batch và nghiên cứu batch kế tiếp.");
    return { woken: result?.status !== "refused", reason: result?.status === "refused" ? "refused" : "woken" };
  }

  submitBenchmark(input: { providerId: string; modelId: string; benchmark: string; version: string; score: number; quote: string; pageId: string }) {
    const page = this.pageById(input.pageId);
    if (!quoteInPage(page.bodyText, input.quote)) {
      return { saved: false, reason: "quote" };
    }
    const body = {
      providerId: input.providerId,
      modelId: input.modelId,
      benchmark: input.benchmark,
      version: input.version,
      score: input.score,
      quote: input.quote,
      sourceUrl: page.url,
      verifiedAt: this.nowFn().toISOString(),
      source: "public_docs" as const,
    };
    this.store.append("benchmark", `${input.providerId}:${input.modelId}:${input.benchmark}:${input.version}`, body);
    return { saved: true, benchmark: body };
  }

  rebuildStats(jobs: Array<{ usage?: { calls?: TaskStatCall[]; signals?: TaskStatSignal[] } }>) {
    const calls: TaskStatCall[] = [];
    const signals: TaskStatSignal[] = [];
    for (const job of jobs) {
      calls.push(...(job.usage?.calls ?? []));
      signals.push(...(job.usage?.signals ?? []));
    }
    const rows = aggregateModelTaskStats(calls, signals);
    for (const row of rows) {
      this.deps.sqlite.prepare(
        "DELETE FROM model_task_stats WHERE provider = ? AND model = ? AND task_id = ? AND day = ?",
      ).run(row.provider, row.model, row.taskId, row.day);
      this.deps.sqlite.prepare(
        `INSERT INTO model_task_stats
         (id, provider, model, task_id, day, calls, success_rate, schema_valid_rate, retries, fallback_rate, fallback_reasons,
          p50_latency_ms, p95_latency_ms, p50_tokens, p95_tokens, p50_cost_usd, p95_cost_usd, quality, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        row.provider,
        row.model,
        row.taskId,
        row.day,
        row.calls,
        String(row.successRate),
        String(row.schemaValidRate),
        row.retries,
        String(row.fallbackRate),
        JSON.stringify(row.fallbackReasons),
        row.p50LatencyMs,
        row.p95LatencyMs,
        row.p50Tokens,
        row.p95Tokens,
        row.p50CostUsd == null ? null : String(row.p50CostUsd),
        row.p95CostUsd == null ? null : String(row.p95CostUsd),
        JSON.stringify(row.quality),
        row.confidence,
      );
    }
    return rows;
  }

  taskStats() {
    return this.deps.sqlite.prepare("SELECT * FROM model_task_stats ORDER BY day DESC").all();
  }

  async runEval(input: {
    suiteIds: string[];
    modelIds: string[];
    models: EvalModelGuard[];
    approved?: boolean;
    remainingRatio?: number;
    projectId?: string;
  }) {
    if (input.projectId === PROTECTED_PROJECT_ID || containsProtectedProject(input)) {
      return { status: "refused" as const, reasonVi: "Dự án này bị từ chối.", callsUsed: 0 };
    }
    const suites = listEvalSuites().filter((suite) => input.suiteIds.includes(suite.id));
    const maxCalls = this.maxCalls();
    const estimated = estimateEvalCalls(suites, input.modelIds.length || input.models.length, 0);
    const decision = decideEvalRun({ models: input.models, estimatedCalls: estimated, maxCalls });
    if (decision.action === "refused" || input.models.some((model) => model.cookie)) {
      return { status: "refused" as const, reasonVi: decision.reasonVi, callsUsed: 0 };
    }
    if (decision.action === "pending" && input.approved !== true) {
      const pending = this.deps.createPending?.("run_model_eval", input, decision.reasonVi);
      const id = randomUUID();
      this.deps.sqlite.prepare(
        `INSERT INTO model_eval_runs (id, suite_ids, model_ids, status, calls_used, max_calls, pending_action_id, summary_vi, started_at, finished_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?, NULL)`,
      ).run(id, JSON.stringify(input.suiteIds), JSON.stringify(input.modelIds), maxCalls, pending?.id ?? null, decision.reasonVi, this.nowFn().toISOString());
      return { status: "pending" as const, pendingActionId: pending?.id ?? null, reasonVi: decision.reasonVi, runId: id };
    }
    if (typeof input.remainingRatio === "number" && input.remainingRatio <= 0.1) {
      return { status: "stopped" as const, reasonVi: "Sắp hết quota, dừng đánh giá.", callsUsed: 0 };
    }
    const runId = randomUUID();
    let callsUsed = 0;
    const at = this.nowFn().toISOString();
    for (const suite of suites) {
      for (const testCase of suite.cases) {
        for (const modelId of input.modelIds) {
          if (typeof input.remainingRatio === "number" && input.remainingRatio - callsUsed * 0.01 <= 0.1 && callsUsed > 0) {
            this.finishEval(runId, input, callsUsed, maxCalls, "stopped", "Sắp hết quota, dừng đánh giá.");
            return { status: "stopped" as const, reasonVi: "Sắp hết quota, dừng đánh giá.", callsUsed, runId };
          }
          const grades = gradeCase(testCase, {});
          this.deps.sqlite.prepare(
            `INSERT INTO model_eval_results
             (id, run_id, suite_id, case_id, model_id, output_json, grades_json, judge_score, cached, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
          ).run(randomUUID(), runId, suite.id, testCase.id, modelId, "{}", JSON.stringify(grades), at);
          callsUsed += 1;
        }
      }
    }
    this.finishEval(runId, input, callsUsed, maxCalls, "done", `Đã chạy ${callsUsed} lượt trên bộ thử.`);
    return { status: "run" as const, reasonVi: decision.reasonVi, callsUsed, runId };
  }

  getEvalRun(id: string) {
    const row = this.deps.sqlite.prepare("SELECT * FROM model_eval_runs WHERE id = ?").get(id);
    const results = this.deps.sqlite.prepare("SELECT * FROM model_eval_results WHERE run_id = ?").all(id);
    return { run: row ?? null, results };
  }

  writeReport(kind = "weekly", markdown?: string): string {
    const providers = this.providers();
    const unverified = providers.filter((item) => item.flags.includes("BILLING_UNVERIFIED"));
    const text = [
      "# Báo cáo nhà cung cấp",
      "",
      "Chưa có nhà cung cấp nào được kiểm chứng cho cá nhân ở Việt Nam, không cần thẻ.",
      "Bảng xếp hạng để trống cho đến khi có trích dẫn từ trang chính thức.",
      "",
      `Nhà cung cấp chưa xác minh thanh toán: ${unverified.length}.`,
      "",
      "Việc cần làm tay:",
      `- ${NEEDS_TOKEN_STEPS_VI}`,
      "- Bật lệnh thường trực nghiên cứu khi muốn chạy.",
      "- Tự đánh dấu đã kiểm tra trên dashboard.",
      "- Không bấm Áp dụng hoặc Cập nhật OmniRoute trước khi đọc phần chênh lệch.",
      "",
      "Xem thêm tại /providers.",
      "",
    ].join("\n");
    const day = this.nowFn().toISOString().slice(0, 10);
    const body = markdown?.trim() ? redactExportText(markdown) : text;
    const relative = kind === "changes"
      ? `reports/changes/${day}.md`
      : kind === "full"
        ? `reports/weekly/${day}-full.md`
        : `reports/${kind}/${day}.md`;
    writeReportFile(this.deps.exportRoot, relative, body);
    this.store.append("report", `${kind}:${day}`, { markdown: body, kind });
    void this.notify((kind === "weekly" || kind === "full" ? body : `Đã ghi báo cáo ${kind}.`).slice(0, 400));
    return body;
  }

  exportAll() {
    const providers = this.providers();
    const offers = partitionOffers(this.allOffers(), this.nowFn());
    const records = this.store.list("provider");
    const details: Record<string, unknown> = {};
    for (const row of records) details[row.key] = row.body;
    const report = this.writeReport();
    const files = writeIntelExport(this.deps.exportRoot, {
      providers,
      models: this.store.list("model").map((row) => row.body),
      activeOffers: offers.active,
      expiredOffers: offers.expired,
      security: records.map((row) => ({ id: row.key })),
      incidents: [],
      tos: records.map((row) => ({ id: row.key })),
      privacy: records.map((row) => ({ id: row.key })),
      providerStatus: [],
      quotaStatus: [],
      health: [],
      routingProfiles: ROUTING_PROFILES,
      policy: { autoConfigNeedsEvidence: true, paidFallbackOff: true },
      billing: providers.map((item) => ({ id: item.id, riskLevel: item.riskLevel, flags: item.flags })),
      autoCharge: [],
      paymentAuth: [],
      exhaustion: [],
      subscriptions: [],
      paidResources: [],
      spendingControls: [],
      chargeWarnings: providers.filter((item) => item.riskLevel === "HIGH" || item.riskLevel === "CRITICAL"),
      connections: this.latestAudit()?.connections ?? [],
      accountBenefits: [],
      cloudBenefits: [],
      unusedBenefits: [],
      expiring: offers.expiring,
      auditHistory: this.store.history("audit", "latest").map((row) => ({ version: row.version, createdAt: row.createdAt })),
      activationMarkdown: `${NEEDS_TOKEN_STEPS_VI}\n\nỨng dụng không tự thêm thẻ và không tự chấp nhận điều khoản.\n`,
      providerIds: records.map((row) => row.key),
      details,
      day: this.nowFn().toISOString().slice(0, 10),
    }, report);
    return { files, root: this.deps.exportRoot };
  }

  private wakesToday = 0;

  private ensureSeeds(): void {
    for (const stub of PROVIDER_STUBS) {
      if (!this.store.current("provider", stub.id)) this.store.append("provider", stub.id, stub);
      this.enqueue(stub.id);
    }
  }

  private enqueue(providerId: string): void {
    const existing = this.deps.sqlite.prepare(
      "SELECT provider_id FROM provider_intel_research_queue WHERE provider_id = ?",
    ).get(providerId);
    if (existing) return;
    this.deps.sqlite.prepare(
      "INSERT INTO provider_intel_research_queue (provider_id, status, attempts, last_run_at, note) VALUES (?, 'todo', 0, NULL, NULL)",
    ).run(providerId);
  }

  private document(id: string): ProviderDocument {
    const row = this.store.current("provider", id);
    if (!row) throw new AppError(404, "PROVIDER_NOT_FOUND", "Không có nhà cung cấp.");
    const parsed = ProviderDocumentSchema.safeParse(row.body);
    if (!parsed.success) throw new AppError(500, "PROVIDER_INVALID", "Hồ sơ nhà cung cấp không hợp lệ.");
    return parsed.data;
  }

  private asRecord(id: string): ProviderRecord {
    const doc = this.document(id);
    if ("billing" in doc) return structuredClone(doc);
    return blankProvider(doc);
  }

  private saveRecord(record: ProviderRecord) {
    const next = recomputeProvider(record, this.offersFor(record.id));
    return this.store.append("provider", record.id, next);
  }

  private offersFor(providerId: string): ProviderOffer[] {
    return this.allOffers().filter((offer) => offer.providerId === providerId);
  }

  private allOffers(): ProviderOffer[] {
    const offers: ProviderOffer[] = [];
    for (const row of this.store.list("offer")) {
      const parsed = OfferSchema.safeParse(row.body);
      if (parsed.success) offers.push(parsed.data);
    }
    return offers;
  }

  private providers() {
    const offers = this.allOffers();
    return this.store.list("provider").map((row) => {
      const card = this.card(row.body);
      const best = offers.find((offer) => offer.providerId === card.id && offer.status === "active" && offer.kind !== "chatbot_only_not_api");
      return { ...card, bestOffer: best?.kind ?? "" };
    });
  }

  private card(body: unknown) {
    const row = body as {
      id?: string;
      name?: string;
      website?: string;
      score?: number;
      flags?: string[];
      autoConfigAllowed?: boolean;
      needsResearch?: boolean;
      legitimacy?: { grade?: string };
      vietnam?: { signupAllowed?: { value?: unknown } };
      billing?: {
        riskLevel?: string;
        cardRequired?: { value?: unknown };
        unverified?: boolean;
        safestZeroSpendConfigVi?: { value?: unknown };
      };
    };
    const flags = row.flags ?? (row.billing ? [] : ["BILLING_UNVERIFIED"]);
    const safest = row.billing?.safestZeroSpendConfigVi?.value;
    return {
      id: String(row.id ?? ""),
      name: String(row.name ?? row.id ?? ""),
      website: String(row.website ?? ""),
      needsResearch: row.needsResearch !== false,
      score: typeof row.score === "number" ? row.score : null,
      riskLevel: row.billing?.riskLevel ?? "UNKNOWN",
      flags,
      autoConfigAllowed: row.autoConfigAllowed === true,
      vietnam: row.vietnam?.signupAllowed?.value === true,
      cardRequired: row.billing?.cardRequired?.value === true,
      legitimacy: row.legitimacy?.grade ?? "UNKNOWN",
      safestVi: typeof safest === "string" && safest !== "UNKNOWN" ? safest : "",
    };
  }

  private pageByUrl(url: string): PageRow | null {
    const row = this.deps.sqlite.prepare("SELECT * FROM provider_intel_pages WHERE url = ?").get(url) as Record<string, unknown> | undefined;
    return row ? this.mapPage(row) : null;
  }

  private pageById(id: string): PageRow {
    const row = this.deps.sqlite.prepare("SELECT * FROM provider_intel_pages WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError(404, "PAGE_NOT_FOUND", "Không thấy trang đã lưu.");
    return this.mapPage(row);
  }

  private mapPage(row: Record<string, unknown>): PageRow {
    return {
      id: String(row.id),
      url: String(row.url),
      providerId: String(row.provider_id),
      pageKind: String(row.page_kind),
      contentHash: String(row.content_hash),
      bodyText: String(row.body_text),
      lastFetchedAt: String(row.last_fetched_at),
      lastChangedAt: String(row.last_changed_at),
      status: String(row.status),
    };
  }

  private addChange(providerId: string, what: string, oldSummary: string, newSummary: string, needsReview: boolean): void {
    this.deps.sqlite.prepare(
      `INSERT INTO provider_intel_changes
       (id, provider_id, what, old_summary, new_summary, needs_review, reviewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(randomUUID(), providerId, what, oldSummary.slice(0, 300), newSummary.slice(0, 300), needsReview ? 1 : 0, this.nowFn().toISOString());
    try {
      new ChangeInbox(this.deps.sqlite, this.nowFn).record({
        category: "D1",
        detector: "D1",
        subject: { type: "provider", id: providerId },
        summary: `${what}: ${newSummary}`.slice(0, 240),
        evidence: { oldSummary, newSummary },
        severity: needsReview ? "high" : "info",
        fingerprint: `intel:${providerId}:${what}`,
      });
    } catch {
      // The intel row is already stored. The inbox must not roll it back.
    }
  }

  private notify(message: string): void {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(MUTE_KEY) as { value: string } | undefined;
    if (row?.value === "1") return;
    const clean = redactExportText(message).slice(0, 500);
    void this.deps.notify?.({ kind: "automation_warning", profile: "Nhà cung cấp AI", message: clean });
  }

  private setting(key: string, value: string): void {
    this.deps.sqlite.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(key, value, this.nowFn().toISOString());
  }

  private latestAudit() {
    const row = this.store.current("audit", "latest");
    if (!row || !row.body || typeof row.body !== "object") return null;
    return row.body as { needsToken: boolean; stepsVi: string | null; connections: Array<{ states: string[] }> };
  }

  private appliedRoutes(): Record<string, string[]> {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(APPLIED_KEY) as { value: string } | undefined;
    if (!row) return {};
    return JSON.parse(row.value) as Record<string, string[]>;
  }

  private queueCount(status?: string): number {
    if (status) {
      const row = this.deps.sqlite.prepare("SELECT COUNT(*) AS n FROM provider_intel_research_queue WHERE status = ?").get(status) as { n: number };
      return Number(row.n);
    }
    const row = this.deps.sqlite.prepare("SELECT COUNT(*) AS n FROM provider_intel_research_queue").get() as { n: number };
    return Number(row.n);
  }

  private runsToday(): number {
    const day = this.nowFn().toISOString().slice(0, 10);
    const row = this.deps.sqlite.prepare("SELECT COUNT(*) AS n FROM operator_runs WHERE day_key = ?").get(day) as { n: number } | undefined;
    return Number(row?.n ?? 0) + this.wakesToday;
  }

  private maxCalls(): number {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(MAX_CALLS_KEY) as { value: string } | undefined;
    const parsed = row ? Number(row.value) : 80;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 80;
  }

  private jobState(): { daily?: string; weekly?: string; monthly?: string } {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(JOBS_KEY) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as { daily?: string; weekly?: string; monthly?: string } : {};
  }

  private async runDaily() {
    let changes = 0;
    const pages = this.deps.sqlite.prepare(
      "SELECT url, provider_id, page_kind, last_fetched_at FROM provider_intel_pages WHERE page_kind IN ('offer', 'pricing', 'status')",
    ).all() as Array<{ url: string; provider_id: string; page_kind: string; last_fetched_at: string }>;
    for (const page of pages) {
      if (this.nowFn().getTime() - Date.parse(page.last_fetched_at) < SIX_HOURS_MS) continue;
      try {
        const result = await this.fetchPage(page.provider_id, page.url, page.page_kind);
        if (result.changed) changes += 1;
      } catch (error) {
        this.deps.logger?.warn?.({ url: page.url, name: error instanceof Error ? error.name : "Error" }, "provider page refresh failed");
      }
    }
    this.expireOffers();
    const expiring = partitionOffers(this.allOffers(), this.nowFn()).expiring;
    await this.audit();
    const state = this.jobState();
    state.daily = this.nowFn().toISOString().slice(0, 10);
    this.setting(JOBS_KEY, JSON.stringify(state));
    if ((changes > 0 || expiring.length > 0) && !getOperatorSettings(this.deps.sqlite).killed) {
      this.wakeFn?.("Nhà cung cấp có thay đổi", "Có trang đổi hoặc ưu đãi sắp hết hạn. Viết báo cáo ngắn.");
    }
    this.rebuildStats(this.jobsWithUsage());
    return { changes, expiring: expiring.length };
  }

  private async runWeekly() {
    const discovered = await this.discoverFromFeeds();
    await this.maybeExtract();
    await this.runProbes();
    const state = this.jobState();
    state.weekly = this.nowFn().toISOString().slice(0, 10);
    this.setting(JOBS_KEY, JSON.stringify(state));
    this.writeReport();
    return { ok: true, discovered };
  }

  private async runMonthly() {
    const pages = this.deps.sqlite.prepare(
      "SELECT url, provider_id, page_kind, last_fetched_at FROM provider_intel_pages WHERE page_kind IN ('tos', 'privacy')",
    ).all() as Array<{ url: string; provider_id: string; page_kind: string; last_fetched_at: string }>;
    for (const page of pages) {
      if (this.nowFn().getTime() - Date.parse(page.last_fetched_at) < SIX_HOURS_MS) continue;
      try {
        const result = await this.fetchPage(page.provider_id, page.url, page.page_kind);
        if (!result.changed) continue;
        const record = this.asRecord(page.provider_id);
        if (page.page_kind === "tos") record.tos.reviewConfidence = "lowered";
        if (page.page_kind === "privacy") record.privacy.reviewConfidence = "lowered";
        this.saveRecord(record);
      } catch (error) {
        this.deps.logger?.warn?.({ url: page.url, name: error instanceof Error ? error.name : "Error" }, "policy refresh failed");
      }
    }
    const state = this.jobState();
    state.monthly = this.nowFn().toISOString().slice(0, 10);
    this.setting(JOBS_KEY, JSON.stringify(state));
    return { ok: true };
  }

  private jobsWithUsage(): Array<{ usage?: { calls?: TaskStatCall[]; signals?: TaskStatSignal[] } }> {
    const rows = this.deps.sqlite.prepare(
      "SELECT usage, finished_at, created_at FROM jobs WHERE usage IS NOT NULL",
    ).all() as Array<{ usage: string; finished_at: string | null; created_at: string }>;
    return rows.map((row) => {
      try {
        const usage = JSON.parse(row.usage) as { calls?: Array<Record<string, unknown>>; signals?: TaskStatSignal[] };
        const day = String(row.finished_at ?? row.created_at ?? "").slice(0, 10);
        const calls: TaskStatCall[] = (usage.calls ?? []).flatMap((call) => {
          if (typeof call.task !== "string" || typeof call.provider !== "string" || typeof call.model !== "string") return [];
          const tokens = typeof call.tokens === "number"
            ? call.tokens
            : Number(call.inputTokens ?? 0) + Number(call.outputTokens ?? 0);
          return [{
            task: call.task,
            provider: call.provider,
            model: call.model,
            ok: call.ok === true,
            schemaValid: typeof call.schemaValid === "boolean" ? call.schemaValid : undefined,
            retries: typeof call.retries === "number" ? call.retries : 0,
            fallback: call.fallback === true,
            fallbackReason: typeof call.fallbackReason === "string" ? call.fallbackReason : undefined,
            latencyMs: typeof call.latencyMs === "number" ? call.latencyMs : undefined,
            tokens,
            costUsd: typeof call.costUsd === "number" ? call.costUsd : undefined,
            day: typeof call.day === "string" ? call.day : day,
          }];
        });
        return { usage: { calls, signals: usage.signals ?? [] } };
      } catch {
        return {};
      }
    });
  }

  private knownHosts(): Set<string> {
    const hosts = new Set<string>();
    for (const row of this.store.list("provider")) {
      const website = (row.body as { website?: string }).website;
      if (!website) continue;
      try {
        hosts.add(new URL(website).host);
      } catch {
        continue;
      }
    }
    return hosts;
  }

  private async discoverFromFeeds(): Promise<string[]> {
    const known = this.knownHosts();
    const added: string[] = [];
    for (const feed of this.feeds()) {
      try {
        const target = new URL(feed.url);
        const robotsUrl = new URL("/robots.txt", target.origin).href;
        const robotsResponse = await this.fetchFn(robotsUrl, {
          headers: { "user-agent": INTEL_USER_AGENT },
          signal: AbortSignal.timeout(15_000),
        });
        const robotsText = await robotsResponse.text();
        if (!robotsResponse.ok || robotsDisallows(robotsText, target.pathname || "/")) continue;
        const response = await this.fetchFn(feed.url, {
          headers: { "user-agent": INTEL_USER_AGENT, accept: "application/rss+xml,application/xml,text/html" },
          signal: AbortSignal.timeout(15_000),
        });
        const text = await response.text();
        for (const candidate of discoverCandidates(text, known)) {
          if (this.store.current("provider", candidate.id)) continue;
          try {
            this.addStub({ ...candidate, discoveredFrom: feed.url });
            added.push(candidate.id);
          } catch (error) {
            this.deps.logger?.warn?.({ name: error instanceof Error ? error.name : "Error" }, "provider stub skipped");
          }
        }
      } catch (error) {
        this.deps.logger?.warn?.({ url: feed.url, name: error instanceof Error ? error.name : "Error" }, "provider feed skipped");
      }
    }
    return added;
  }

  private async maybeExtract(): Promise<void> {
    if (!this.allowAutoExtract || !this.extractFn) return;
    const page = this.deps.sqlite.prepare(
      "SELECT id FROM provider_intel_pages ORDER BY last_fetched_at DESC LIMIT 1",
    ).get() as { id: string } | undefined;
    if (!page) return;
    try {
      await this.extractStoredPage(page.id);
    } catch (error) {
      this.deps.logger?.warn?.({ name: error instanceof Error ? error.name : "Error" }, "provider extract skipped");
    }
  }

  private noteUnknownConnections(connections: Array<{ provider: string; label: string }>): void {
    for (const connection of connections) {
      const id = providerSlug(connection.provider);
      if (!id || this.store.current("provider", id)) continue;
      this.addChange(id, "Kết nối OmniRoute chưa có hồ sơ", connection.label, "Cần website chính thức trước khi ghi stub", true);
    }
  }

  private paidFallbackEnabled(): boolean {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get("llmQuota") as { value: string } | undefined;
    if (!row) return false;
    try {
      const value = JSON.parse(row.value) as { quotaPolicy?: string };
      return value.quotaPolicy === "paid_fallback";
    } catch {
      return false;
    }
  }

  private finishEval(runId: string, input: { suiteIds: string[]; modelIds: string[] }, callsUsed: number, maxCalls: number, status: string, summary: string): void {
    this.deps.sqlite.prepare(
      `INSERT INTO model_eval_runs (id, suite_ids, model_ids, status, calls_used, max_calls, pending_action_id, summary_vi, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, calls_used = excluded.calls_used, summary_vi = excluded.summary_vi, finished_at = excluded.finished_at`,
    ).run(runId, JSON.stringify(input.suiteIds), JSON.stringify(input.modelIds), status, callsUsed, maxCalls, summary, this.nowFn().toISOString(), this.nowFn().toISOString());
  }
}
