import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import {
  AspectRatioSchema,
  PublicationSchema,
  VideoMetadataDraftSchema,
  aspectFromAccountFormat,
  type AccountConnectionDetail,
  type AccountFormat,
  type CreatePublicationsBody,
  type ListPublicationsQuery,
  type PlatformId,
  type Publication,
  type PublicationListItem,
  type PublicationListResponse,
  type PublicationStatus,
  type PublishInput,
  type PublishVisibility,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { JobRepository } from "../jobs/jobRepository.js";
import type { RenderService } from "../services/renderService.js";
import { hasEnvAppCredentials } from "./envAppCredentials.js";
import { evaluatePublishGuardrail } from "./guardrail.js";
import type { PublisherRegistry } from "./registry.js";
import type { TokenVault } from "./tokenVault.js";
import { trimPublishMetadata } from "./trimMetadata.js";
import type { Publisher } from "./types.js";

const ACTIVE_STATUSES: PublicationStatus[] = ["QUEUED", "SCHEDULED", "UPLOADING", "PUBLISHED"];
const REFRESH_SKEW_MS = 5 * 60 * 1000;

type AccountRow = {
  id: string;
  profile_id: string;
  platform: PlatformId;
  display_name: string;
  handle: string | null;
  external_id: string | null;
  format: AccountFormat;
  enabled: number;
  connection: string;
  connection_error: string | null;
  last_checked_at: string | null;
  publish_settings: string;
};

type PublicationRow = {
  id: string;
  project_id: string;
  render_id: string;
  account_id: string;
  status: PublicationStatus;
  visibility_requested: string;
  visibility_used: string;
  guardrail_reason: string | null;
  scheduled_for: string | null;
  external_id: string | null;
  external_url: string | null;
  attempts: number;
  last_error: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type ProjectRow = {
  id: string;
  title: string;
  profile_id: string | null;
  settings: string;
  language?: string;
};

export class PublishService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly vault: TokenVault,
    private readonly registry: PublisherRegistry,
    private readonly jobs: JobRepository,
    private readonly renders: RenderService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  oauthRedirectUri(platform: string): string {
    return `http://127.0.0.1:${this.config.PORT}/api/oauth/${platform}/callback`;
  }

  webProfileUrl(profileId: string): string {
    const base = this.config.CORS_ORIGIN.replace(/\/+$/, "");
    return `${base}/profiles/${profileId}/accounts`;
  }

  listForProject(projectId: string): Publication[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM publications WHERE project_id = ? ORDER BY created_at DESC",
    ).all(projectId) as PublicationRow[];
    return rows.map((row) => this.toPublication(row));
  }

  listGlobal(query: ListPublicationsQuery): PublicationListResponse {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      clauses.push("p.status = ?");
      params.push(query.status);
    }
    if (query.profileId) {
      clauses.push("a.profile_id = ?");
      params.push(query.profileId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite.prepare(
      `SELECT p.*, a.platform, a.display_name AS account_display_name, a.profile_id, pr.title AS project_title
       FROM publications p
       JOIN platform_accounts a ON a.id = p.account_id
       JOIN projects pr ON pr.id = p.project_id
       ${where}
       ORDER BY COALESCE(p.scheduled_for, p.created_at) DESC
       LIMIT 500`,
    ).all(...params) as Array<PublicationRow & {
      platform: PlatformId;
      account_display_name: string;
      profile_id: string;
      project_title: string;
    }>;
    return {
      items: rows.map((row) => ({
        ...this.toPublication(row),
        platform: row.platform,
        accountDisplayName: row.account_display_name,
        projectTitle: row.project_title,
        profileId: row.profile_id,
      })),
    };
  }

  get(id: string): Publication | undefined {
    const row = this.sqlite.prepare("SELECT * FROM publications WHERE id = ?").get(id) as PublicationRow | undefined;
    return row ? this.toPublication(row) : undefined;
  }

  require(id: string): Publication {
    const publication = this.get(id);
    if (!publication) throw new AppError(404, "PUBLICATION_NOT_FOUND", "Publication not found");
    return publication;
  }

  async createForProject(projectId: string, body: CreatePublicationsBody): Promise<Publication[]> {
    const project = this.sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");

    const created: Publication[] = [];
    for (const accountId of body.accountIds) {
      const account = this.requireAccount(accountId);
      if (account.connection !== "CONNECTED") {
        throw new AppError(409, "ACCOUNT_NOT_CONNECTED", `Tài khoản ${account.display_name} chưa kết nối`);
      }
      if (!this.registry.has(account.platform)) {
        throw new AppError(400, "PUBLISHER_UNAVAILABLE", `Chưa hỗ trợ đăng lên ${account.platform}`);
      }

      const render = await this.resolveRenderForAccount(project, account);
      const existing = this.findActive(render.id, accountId);
      if (existing && !body.force) {
        created.push(existing);
        continue;
      }

      const publisher = this.registry.require(account.platform);
      const visibilityRequested = (body.visibility
        ?? this.parsePublishSettings(account.publish_settings).visibility) as PublishVisibility;
      const guardrail = evaluatePublishGuardrail(this.sqlite, projectId, render.id);
      const visibilityUsed: PublishVisibility = guardrail.forcePrivate ? "private" : visibilityRequested;

      const scheduledFor = body.scheduledFor ?? null;
      const nowIso = this.now().toISOString();
      let status: PublicationStatus = "QUEUED";
      if (scheduledFor && new Date(scheduledFor).getTime() > this.now().getTime()) {
        if (publisher.limits.supportsScheduledPublishAt) {
          status = "QUEUED"; // upload now as private with publishAt
        } else {
          status = "SCHEDULED";
        }
      }

      const id = randomUUID();
      this.sqlite.prepare(
        `INSERT INTO publications (
          id, project_id, render_id, account_id, status,
          visibility_requested, visibility_used, guardrail_reason, scheduled_for,
          external_id, external_url, attempts, last_error, progress,
          created_at, updated_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, 0, ?, ?, NULL)`,
      ).run(
        id,
        projectId,
        render.id,
        accountId,
        status,
        visibilityRequested,
        visibilityUsed,
        guardrail.reason,
        scheduledFor,
        nowIso,
        nowIso,
      );

      const publication = this.require(id);
      if (status === "QUEUED") {
        this.enqueuePublishJob(projectId, id);
      }
      created.push(publication);
    }
    return created;
  }

  cancel(id: string): Publication {
    const publication = this.require(id);
    if (publication.status === "UPLOADING" || publication.status === "PUBLISHED") {
      throw new AppError(409, "PUBLICATION_NOT_CANCELLABLE", "Chỉ hủy được trước khi đang tải lên");
    }
    if (publication.status === "CANCELLED") return publication;
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      "UPDATE publications SET status = 'CANCELLED', updated_at = ?, last_error = NULL WHERE id = ?",
    ).run(nowIso, id);
    // Cancel queued PUBLISH jobs for this publication
    this.sqlite.prepare(
      `UPDATE jobs SET status = 'CANCELLED', finished_at = ?, message = ?
       WHERE project_id = ? AND stage = 'PUBLISH' AND scope = ? AND status IN ('QUEUED')`,
    ).run(nowIso, "Publication cancelled", publication.projectId, id);
    return this.require(id);
  }

  retry(id: string): Publication {
    const publication = this.require(id);
    if (publication.status !== "FAILED" && publication.status !== "CANCELLED") {
      throw new AppError(409, "PUBLICATION_NOT_RETRYABLE", "Chỉ thử lại được bài đăng thất bại hoặc đã hủy");
    }
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      `UPDATE publications SET status = 'QUEUED', progress = 0, last_error = NULL,
       attempts = 0, updated_at = ?, published_at = NULL, external_id = NULL, external_url = NULL
       WHERE id = ?`,
    ).run(nowIso, id);
    this.enqueuePublishJob(publication.projectId, id);
    return this.require(id);
  }

  /** Tick due SCHEDULED jobs whose scheduled_for has passed. */
  promoteDueScheduled(): number {
    const nowIso = this.now().toISOString();
    const due = this.sqlite.prepare(
      `SELECT id, project_id FROM publications
       WHERE status = 'SCHEDULED' AND scheduled_for IS NOT NULL AND scheduled_for <= ?`,
    ).all(nowIso) as Array<{ id: string; project_id: string }>;
    for (const row of due) {
      this.sqlite.prepare(
        "UPDATE publications SET status = 'QUEUED', updated_at = ? WHERE id = ?",
      ).run(nowIso, row.id);
      this.enqueuePublishJob(row.project_id, row.id);
    }
    return due.length;
  }

  /**
   * Daily connection check: refresh identity for connected accounts not checked in 24h.
   */
  async runDailyConnectionChecks(signal: AbortSignal): Promise<number> {
    const cutoff = new Date(this.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    const accounts = this.sqlite.prepare(
      `SELECT * FROM platform_accounts
       WHERE connection = 'CONNECTED'
         AND (last_checked_at IS NULL OR last_checked_at < ?)`,
    ).all(cutoff) as AccountRow[];
    let checked = 0;
    for (const account of accounts) {
      if (signal.aborted) break;
      if (!this.registry.has(account.platform)) continue;
      try {
        await this.checkConnection(account.id, signal);
        checked += 1;
      } catch {
        // checkConnection already sets EXPIRED/ERROR
      }
    }
    return checked;
  }

  async checkConnection(accountId: string, signal: AbortSignal): Promise<void> {
    const account = this.requireAccount(accountId);
    const publisher = this.registry.get(account.platform);
    if (!publisher) throw new AppError(400, "PUBLISHER_UNAVAILABLE", "Publisher unavailable");
    let tokens = this.vault.loadTokens(accountId);
    if (!tokens) {
      this.setConnection(accountId, "EXPIRED", "Cần kết nối lại tài khoản");
      throw new AppError(409, "ACCOUNT_EXPIRED", "Cần kết nối lại tài khoản");
    }
    tokens = await this.ensureFreshTokens(accountId, account.platform, publisher, tokens, signal);
    const identity = await publisher.oauth.fetchIdentity(tokens, signal);
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      `UPDATE platform_accounts SET display_name = ?, handle = ?, external_id = ?,
       connection = 'CONNECTED', connection_error = NULL, last_checked_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      identity.displayName,
      identity.handle ?? account.handle,
      identity.externalId,
      nowIso,
      nowIso,
      accountId,
    );
  }

  async disconnect(profileId: string, accountId: string, signal: AbortSignal): Promise<void> {
    const account = this.requireAccount(accountId);
    if (account.profile_id !== profileId) {
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    }
    const publisher = this.registry.get(account.platform);
    const tokens = this.vault.loadTokens(accountId);
    if (tokens && publisher?.oauth.revoke) {
      try {
        await publisher.oauth.revoke(tokens, signal);
      } catch {
        // Best-effort revoke
      }
    }
    this.vault.deleteTokens(accountId);
    this.setConnection(accountId, "NOT_CONNECTED", null);
    this.sqlite.prepare(
      "UPDATE platform_accounts SET external_id = NULL, last_checked_at = NULL, updated_at = ? WHERE id = ?",
    ).run(this.now().toISOString(), accountId);
  }

  connectionDetail(accountId: string): AccountConnectionDetail {
    const account = this.requireAccount(accountId);
    const meta = this.vault.getCredentialMeta(accountId);
    const appCredentials = this.vault.appCredentialsStatus(accountId, account.profile_id, account.platform);
    const { canConnect, connectBlockedReason } = this.resolveConnectAvailability(
      account.platform,
      appCredentials.configured,
    );
    return {
      connection: account.connection as AccountConnectionDetail["connection"],
      connectionError: account.connection_error,
      displayName: account.display_name,
      handle: account.handle,
      externalId: account.external_id,
      tokenExpiresAt: meta?.expiresAt ?? null,
      scopes: meta?.scopes ?? [],
      lastCheckedAt: account.last_checked_at,
      appCredentials,
      redirectUri: this.oauthRedirectUri(account.platform),
      canConnect,
      connectBlockedReason,
    };
  }

  private resolveConnectAvailability(
    platform: PlatformId,
    vaultConfigured: boolean,
  ): { canConnect: boolean; connectBlockedReason: string | null } {
    if (!this.registry.has(platform)) {
      return {
        canConnect: false,
        connectBlockedReason: "Nền tảng này chưa được hỗ trợ đăng tự động",
      };
    }
    if (platform === "mock" || vaultConfigured || hasEnvAppCredentials(platform, this.config)) {
      return { canConnect: true, connectBlockedReason: null };
    }
    return {
      canConnect: false,
      connectBlockedReason:
        "Chưa có thông tin ứng dụng (nhập ở mục Thông tin ứng dụng hoặc đặt trong .env)",
    };
  }

  /** Build PublishInput + ensure tokens for the executor. */
  async prepareUpload(
    publicationId: string,
    signal: AbortSignal,
  ): Promise<{
    publication: Publication;
    input: PublishInput;
    tokens: import("@vg/shared").TokenSet;
    publisher: Publisher;
  }> {
    const publication = this.require(publicationId);
    if (publication.status === "CANCELLED") {
      throw Object.assign(new Error("Publication cancelled"), { status: 409, retryable: false });
    }
    const account = this.requireAccount(publication.accountId);
    const publisher = this.registry.require(account.platform);

    let tokens = this.vault.loadTokens(publication.accountId);
    if (!tokens) {
      this.setConnection(publication.accountId, "EXPIRED", "Cần kết nối lại tài khoản");
      throw Object.assign(new Error("Cần kết nối lại tài khoản"), { status: 401, retryable: false });
    }
    try {
      tokens = await this.ensureFreshTokens(publication.accountId, account.platform, publisher, tokens, signal);
    } catch (error) {
      this.setConnection(publication.accountId, "EXPIRED", "Cần kết nối lại tài khoản");
      throw Object.assign(new Error("Cần kết nối lại tài khoản"), {
        status: 401,
        retryable: false,
        cause: error,
      });
    }

    const render = this.sqlite.prepare(
      "SELECT id, output_path, status FROM renders WHERE id = ?",
    ).get(publication.renderId) as { id: string; output_path: string; status: string } | undefined;
    if (!render || render.status !== "DONE") {
      throw Object.assign(new Error("Render không sẵn sàng"), { status: 409, retryable: true });
    }

    const project = this.sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(publication.projectId) as ProjectRow;
    const settings = typeof project.settings === "string"
      ? JSON.parse(project.settings) as { language?: string }
      : project.settings as { language?: string };
    const meta = this.loadEffectiveMetadata(publication.projectId);
    const trimmed = trimPublishMetadata(
      {
        title: meta.titles[0] ?? project.title,
        description: meta.description,
        tags: meta.tags,
        hashtags: meta.hashtags,
      },
      publisher.limits,
      { mergeHashtags: account.platform !== "youtube" && account.platform !== "mock" },
    );

    let visibility = publication.visibilityUsed as PublishVisibility;
    let publishAt: string | undefined;
    if (
      publication.scheduledFor
      && publisher.limits.supportsScheduledPublishAt
      && new Date(publication.scheduledFor).getTime() > this.now().getTime()
    ) {
      visibility = "private";
      publishAt = publication.scheduledFor;
    }

    const videoPath = isAbsolute(render.output_path)
      ? render.output_path
      : join(this.config.DATA_DIR, render.output_path);
    const input: PublishInput = {
      videoPath,
      format: account.format,
      title: trimmed.title,
      description: trimmed.description,
      tags: trimmed.tags,
      visibility,
      ...(publishAt ? { publishAt } : {}),
      language: settings.language ?? "vi",
      madeForKids: false,
      aiDisclosure: true,
    };

    return { publication, input, tokens, publisher };
  }

  markUploading(publicationId: string): void {
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      "UPDATE publications SET status = 'UPLOADING', progress = 1, updated_at = ?, attempts = attempts + 1 WHERE id = ?",
    ).run(nowIso, publicationId);
  }

  updateProgress(publicationId: string, progress: number): void {
    this.sqlite.prepare(
      "UPDATE publications SET progress = ?, updated_at = ? WHERE id = ?",
    ).run(Math.max(0, Math.min(100, progress)), this.now().toISOString(), publicationId);
  }

  markPublished(publicationId: string, result: { externalId: string; externalUrl: string }): void {
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      `UPDATE publications SET status = 'PUBLISHED', progress = 100, external_id = ?, external_url = ?,
       published_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
    ).run(result.externalId, result.externalUrl, nowIso, nowIso, publicationId);
  }

  markFailed(publicationId: string, message: string): void {
    this.sqlite.prepare(
      `UPDATE publications SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?`,
    ).run(message, this.now().toISOString(), publicationId);
  }

  private enqueuePublishJob(projectId: string, publicationId: string): void {
    this.jobs.createJob({
      projectId,
      stage: "PUBLISH",
      scope: publicationId,
      maxAttempts: this.config.JOB_MAX_ATTEMPTS,
      previousState: "PENDING",
      runAfter: this.now(),
    });
  }

  private async ensureFreshTokens(
    accountId: string,
    _platform: PlatformId,
    publisher: Publisher,
    tokens: import("@vg/shared").TokenSet,
    signal: AbortSignal,
  ): Promise<import("@vg/shared").TokenSet> {
    void _platform;
    if (!tokens.expiresAt) return tokens;
    const expiresAt = Date.parse(tokens.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt - this.now().getTime() > REFRESH_SKEW_MS) {
      return tokens;
    }
    const refreshed = await publisher.oauth.refresh(tokens, signal);
    this.vault.storeTokens(accountId, refreshed, refreshed.scopes);
    return refreshed;
  }

  private async resolveRenderForAccount(
    project: ProjectRow,
    account: AccountRow,
  ): Promise<{ id: string; output_path: string; aspect_ratio: string | null }> {
    const fullProject = this.jobs.getProject(project.id);
    if (!fullProject) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const projectAspect = AspectRatioSchema.parse(fullProject.settings.aspectRatio ?? "16:9");
    const needed = aspectFromAccountFormat(account.format);

    const rows = this.sqlite.prepare(
      `SELECT id, output_path, aspect_ratio, status, deleted_at, created_at
       FROM renders WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    ).all(project.id) as Array<{
      id: string;
      output_path: string;
      aspect_ratio: string | null;
      status: string;
      deleted_at: string | null;
      created_at: string;
    }>;

    const match = rows.find((row) => (row.aspect_ratio ?? projectAspect) === needed);
    if (match) return match;

    // Render the missing aspect variant synchronously (TASK-023 pattern).
    const { render } = await this.renders.render(
      fullProject,
      AbortSignal.timeout(this.config.STAGE_TIMEOUT_MS),
      () => {},
      { aspectRatio: needed },
    );
    const row = this.sqlite.prepare(
      "SELECT id, output_path, aspect_ratio FROM renders WHERE id = ?",
    ).get(render.id) as { id: string; output_path: string; aspect_ratio: string | null };
    return row;
  }

  private findActive(renderId: string, accountId: string): Publication | undefined {
    const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
    const row = this.sqlite.prepare(
      `SELECT * FROM publications
       WHERE render_id = ? AND account_id = ? AND status IN (${placeholders})
       ORDER BY created_at DESC LIMIT 1`,
    ).get(renderId, accountId, ...ACTIVE_STATUSES) as PublicationRow | undefined;
    return row ? this.toPublication(row) : undefined;
  }

  private loadEffectiveMetadata(projectId: string): {
    titles: string[];
    description: string;
    tags: string[];
    hashtags: string[];
  } {
    const row = this.sqlite.prepare(
      "SELECT draft, edited FROM video_metadata WHERE project_id = ?",
    ).get(projectId) as { draft: string; edited: string | null } | undefined;
    if (!row) {
      return { titles: ["Untitled"], description: "", tags: [], hashtags: [] };
    }
    const draft = VideoMetadataDraftSchema.parse(
      typeof row.draft === "string" ? JSON.parse(row.draft) : row.draft,
    );
    const edited = row.edited
      ? VideoMetadataDraftSchema.parse(typeof row.edited === "string" ? JSON.parse(row.edited) : row.edited)
      : null;
    return edited ?? draft;
  }

  private parsePublishSettings(raw: string): { visibility: PublishVisibility; autoPublish: boolean } {
    const parsed = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw;
    return {
      visibility: (parsed.visibility as PublishVisibility) ?? "public",
      autoPublish: Boolean(parsed.autoPublish),
    };
  }

  requireAccount(accountId: string): AccountRow {
    const row = this.sqlite.prepare("SELECT * FROM platform_accounts WHERE id = ?").get(accountId) as AccountRow | undefined;
    if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    return row;
  }

  setConnection(accountId: string, connection: string, error: string | null): void {
    this.sqlite.prepare(
      "UPDATE platform_accounts SET connection = ?, connection_error = ?, updated_at = ? WHERE id = ?",
    ).run(connection, error, this.now().toISOString(), accountId);
  }

  applyOAuthSuccess(input: {
    accountId: string;
    tokens: import("@vg/shared").TokenSet;
    identity: { displayName: string; handle?: string; externalId: string };
  }): { profileId: string } {
    const account = this.requireAccount(input.accountId);
    this.vault.storeTokens(input.accountId, input.tokens, input.tokens.scopes);
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      `UPDATE platform_accounts SET display_name = ?, handle = ?, external_id = ?,
       connection = 'CONNECTED', connection_error = NULL, last_checked_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.identity.displayName,
      input.identity.handle ?? account.handle,
      input.identity.externalId,
      nowIso,
      nowIso,
      input.accountId,
    );
    return { profileId: account.profile_id };
  }

  private toPublication(row: PublicationRow): Publication {
    return PublicationSchema.parse({
      id: row.id,
      projectId: row.project_id,
      renderId: row.render_id,
      accountId: row.account_id,
      status: row.status,
      visibilityRequested: row.visibility_requested,
      visibilityUsed: row.visibility_used,
      guardrailReason: row.guardrail_reason,
      scheduledFor: row.scheduled_for,
      externalId: row.external_id,
      externalUrl: row.external_url,
      attempts: row.attempts,
      lastError: row.last_error,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
    });
  }
}

// silence unused import for list item type re-export convenience
export type { PublicationListItem };
