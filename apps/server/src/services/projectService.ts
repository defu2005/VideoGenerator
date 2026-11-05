import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  PROJECT_STATUSES,
  ProjectSchema,
  LlmSettingsSchema,
  PipelineStageSchema,
  ProjectStatusSchema,
  mainAspectFromFormats,
  recommendBrief,
  type CreateProjectInput,
  type DashboardStats,
  type Project,
  type ProjectListQuery,
  type ProjectListResponse,
  type ProjectSettings,
  type ProjectSettingsInput,
  type UpdateProjectInput,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppDatabase } from "../db/client.js";
import { jobs, projects, type ProjectRow } from "../db/schema.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { createProjectDir, removeProjectDir } from "../storage/paths.js";
import type Database from "better-sqlite3";
import { getGuidelineProfiles, normalizeGuidelineSettings } from "../guidelines/settings.js";
import type { ProfileService } from "./profileService.js";

const toProject = (row: ProjectRow): Project => ProjectSchema.parse({
  ...row,
  profileId: row.profileId ?? null,
});
const BRIEF_SETTING_FIELDS = new Set([
  "budget",
  "platform",
  "style",
  "tone",
  "audience",
  "language",
  "targetDurationSec",
  "aspectRatio",
  "wordsPerMinute",
  "sceneDurationSec",
  "visualStyle",
]);

function briefSettingsFromInput(input: CreateProjectInput | UpdateProjectInput): ProjectSettingsInput {
  return {
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    ...(input.style === undefined ? {} : { style: input.style }),
    ...(input.tone === undefined ? {} : { tone: input.tone }),
    ...(input.audience === undefined ? {} : { audience: input.audience }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(input.targetDurationSec === undefined ? {} : { targetDurationSec: input.targetDurationSec }),
    ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
    ...(input.wordsPerMinute === undefined ? {} : { wordsPerMinute: input.wordsPerMinute }),
    ...(input.sceneDurationSec === undefined ? {} : { sceneDurationSec: input.sceneDurationSec }),
    ...(input.visualStyle === undefined ? {} : { visualStyle: input.visualStyle }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.subtitles === undefined ? {} : { subtitles: input.subtitles }),
    ...(input.music === undefined ? {} : { music: input.music }),
    ...(input.userSet === undefined ? {} : { userSet: input.userSet }),
  };
}

function normalizeLlmSettings(settings: ProjectSettingsInput["llm"]): ProjectSettings["llm"] {
  if (!settings) return undefined;
  return LlmSettingsSchema.parse({
    ...settings,
    tasks: Object.fromEntries(Object.entries(settings.tasks ?? {}).filter(([, route]) => route !== null)),
  });
}

function defaultGuidelineSettings(sqlite: Database.Database): ProjectSettings["guidelines"] {
  const profiles = getGuidelineProfiles(sqlite);
  return profiles.profiles.find((profile) => profile.id === profiles.defaultProfileId)?.guidelines
    ?? { platformPack: "auto", customRules: [] };
}

function mergeSettings(current: ProjectSettings, update: ProjectSettingsInput): ProjectSettings {
  return {
    ...current,
    ...update,
    subtitles: {
      ...current.subtitles,
      ...update.subtitles,
    },
    music: {
      ...current.music,
      ...update.music,
    },
    budget: {
      ...current.budget,
      ...update.budget,
      features: {
        ...current.budget.features,
        ...update.budget?.features,
      },
    },
    stageExecutors: {
      ...current.stageExecutors,
      ...update.stageExecutors,
    },
    voice: update.voice
      ? { ...current.voice, ...update.voice }
      : current.voice,
    llm: update.llm
      ? (() => {
        const tasks = { ...current.llm?.tasks };
        for (const [task, route] of Object.entries(update.llm.tasks ?? {})) {
          if (route === null) delete tasks[task as keyof typeof tasks];
          else if (route) tasks[task as keyof typeof tasks] = route;
        }
        return LlmSettingsSchema.parse({
          ...current.llm,
          ...update.llm,
          tasks,
        });
      })()
      : current.llm,
    guidelines: update.guidelines
      ? normalizeGuidelineSettings(update.guidelines, current.guidelines)
      : current.guidelines ?? { platformPack: "auto", customRules: [] },
  };
}

export function createProjectService(
  db: AppDatabase,
  config: AppConfig,
  logger: FastifyBaseLogger,
  sqlite: Database.Database,
  profiles?: ProfileService,
) {
  async function getProject(id: string): Promise<Project | undefined> {
    const row = await db.select().from(projects).where(eq(projects.id, id)).get();
    return row ? toProject(row) : undefined;
  }

  async function createProject(input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const id = randomUUID();

    let profileSeed: ProjectSettingsInput = {};
    let profileMode: CreateProjectInput["mode"];
    let profileFormats: Array<"landscape" | "vertical"> = [];
    if (input.profileId) {
      if (!profiles) throw new AppError(500, "INTERNAL_ERROR", "Profile service unavailable");
      const seed = await profiles.settingsSeedFromProfile(input.profileId);
      profileSeed = seed.settings;
      profileMode = seed.mode;
      profileFormats = seed.formats;
    }

    const requestSettings: ProjectSettingsInput = {
      ...briefSettingsFromInput(input),
      ...input.settings,
    };
    const inputSettings: ProjectSettingsInput = {
      ...profileSeed,
      ...requestSettings,
      subtitles: {
        ...profileSeed.subtitles,
        ...requestSettings.subtitles,
      },
      music: {
        ...profileSeed.music,
        ...requestSettings.music,
      },
      budget: {
        ...profileSeed.budget,
        ...requestSettings.budget,
        features: {
          ...profileSeed.budget?.features,
          ...requestSettings.budget?.features,
        },
      },
      voice: requestSettings.voice
        ? { ...profileSeed.voice, ...requestSettings.voice }
        : profileSeed.voice,
      llm: requestSettings.llm ?? profileSeed.llm,
      guidelines: requestSettings.guidelines ?? profileSeed.guidelines,
    };

    // Aspect from profile main format unless the request set it.
    const requestSetAspect = requestSettings.aspectRatio !== undefined
      || (input.settings?.aspectRatio !== undefined)
      || (input.aspectRatio !== undefined);
    if (!requestSetAspect) {
      const derived = mainAspectFromFormats(profileFormats);
      if (derived) inputSettings.aspectRatio = derived;
    }

    const explicitBriefFields = Object.keys(inputSettings).filter((field) => BRIEF_SETTING_FIELDS.has(field));
    const nestedBriefFields = [
      ...Object.keys(inputSettings.subtitles ?? {}).map((field) => `subtitles.${field}`),
      ...Object.keys(inputSettings.music ?? {}).map((field) => `music.${field}`),
      ...(inputSettings.budget?.mode === undefined ? [] : ["budget.mode"]),
      ...Object.keys(inputSettings.budget?.features ?? {}).map((field) => `budget.features.${field}`),
      ...(inputSettings.researchMode === undefined ? [] : ["researchMode"]),
    ];
    // Lock profile seed + request overrides so recommendBrief does not overwrite them.
    const profileExplicit = Object.keys(profileSeed).filter((field) => BRIEF_SETTING_FIELDS.has(field));
    const profileNested = [
      ...Object.keys(profileSeed.subtitles ?? {}).map((field) => `subtitles.${field}`),
      ...Object.keys(profileSeed.music ?? {}).map((field) => `music.${field}`),
      ...(profileSeed.budget?.mode === undefined ? [] : ["budget.mode"]),
      ...Object.keys(profileSeed.budget?.features ?? {}).map((field) => `budget.features.${field}`),
    ];
    const requestExplicit = Object.keys(requestSettings).filter((field) => BRIEF_SETTING_FIELDS.has(field));
    const requestNested = [
      ...Object.keys(requestSettings.subtitles ?? {}).map((field) => `subtitles.${field}`),
      ...Object.keys(requestSettings.music ?? {}).map((field) => `music.${field}`),
      ...(requestSettings.budget?.mode === undefined ? [] : ["budget.mode"]),
      ...Object.keys(requestSettings.budget?.features ?? {}).map((field) => `budget.features.${field}`),
      ...(requestSettings.researchMode === undefined ? [] : ["researchMode"]),
    ];
    const userSet = [...new Set([
      ...(requestSettings.userSet ?? []),
      ...(input.title === undefined ? [] : ["title"]),
      ...profileExplicit,
      ...profileNested,
      ...requestExplicit,
      ...requestNested,
    ])];
    void explicitBriefFields;
    const { guidelines: ignoredGuidelines, ...briefInput } = inputSettings;
    void ignoredGuidelines;
    const resolvedMode = input.mode ?? profileMode ?? "ASSISTED";
    const resolved = recommendBrief({
      topic: input.topic,
      title: input.title,
      description: input.description ?? "",
      mode: resolvedMode,
      settings: { ...briefInput, userSet },
    });
    // If aspect came from profile format and recommendBrief may have overwritten it, restore when not user-set.
    let aspectRatio = resolved.values.settings.aspectRatio;
    if (!userSet.includes("aspectRatio") && !requestSetAspect) {
      const derived = mainAspectFromFormats(profileFormats);
      if (derived) aspectRatio = derived;
    }
    const settings: ProjectSettings = {
      language: resolved.values.settings.language,
      targetDurationSec: resolved.values.settings.targetDurationSec,
      aspectRatio,
      platform: resolved.values.settings.platform,
      style: resolved.values.settings.style,
      tone: resolved.values.settings.tone,
      audience: resolved.values.settings.audience,
      wordsPerMinute: resolved.values.settings.wordsPerMinute,
      sceneDurationSec: resolved.values.settings.sceneDurationSec,
      visualStyle: resolved.values.settings.visualStyle,
      subtitles: resolved.values.settings.subtitles,
      music: resolved.values.settings.music,
      budget: resolved.values.settings.budget,
      userSet,
      researchMode: inputSettings.researchMode,
      stageExecutors: inputSettings.stageExecutors ?? {},
      voice: inputSettings.voice,
      llm: normalizeLlmSettings(inputSettings.llm),
      autoRender: inputSettings.autoRender ?? false,
      guidelines: inputSettings.guidelines
        ? normalizeGuidelineSettings(inputSettings.guidelines)
        : defaultGuidelineSettings(sqlite),
    };
    const project: Project = {
      id,
      title: resolved.values.title,
      description: input.description ?? "",
      topic: input.topic,
      mode: resolvedMode,
      settings,
      status: "DRAFT",
      stage: "TOPIC",
      thumbnailPath: null,
      durationSec: null,
      version: 1,
      profileId: input.profileId ?? null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    await db.insert(projects).values(project).run();
    try {
      createProjectDir(config.DATA_DIR, id);
    } catch (error) {
      await db.delete(projects).where(eq(projects.id, id)).run();
      throw error;
    }
    return project;
  }

  async function updateProject(id: string, input: UpdateProjectInput): Promise<Project | undefined> {
    const current = await getProject(id);
    if (!current) return undefined;

    const updates: Partial<ProjectRow> = {
      updatedAt: new Date().toISOString(),
    };
    if (input.description !== undefined) updates.description = input.description;
    if (input.mode !== undefined) updates.mode = input.mode;
    const settingsInput: ProjectSettingsInput = {
      ...briefSettingsFromInput(input),
      ...input.settings,
    };
    const hasSettingsUpdate = Object.keys(settingsInput).length > 0;
    const settings = hasSettingsUpdate ? mergeSettings(current.settings, settingsInput) : current.settings;

    const explicitBriefFields = Object.keys(settingsInput).filter((field) => BRIEF_SETTING_FIELDS.has(field));
    const nestedBriefFields = [
      ...Object.keys(settingsInput.subtitles ?? {}).map((field) => `subtitles.${field}`),
      ...Object.keys(settingsInput.music ?? {}).map((field) => `music.${field}`),
      ...(settingsInput.budget?.mode === undefined ? [] : ["budget.mode"]),
      ...Object.keys(settingsInput.budget?.features ?? {}).map((field) => `budget.features.${field}`),
      ...(settingsInput.researchMode === undefined ? [] : ["researchMode"]),
    ];
    const resetFields = new Set(input.resetToRecommended ?? []);
    const userSet = [...new Set([
      ...current.settings.userSet,
      ...(input.title === undefined ? [] : ["title"]),
      ...explicitBriefFields,
      ...nestedBriefFields,
      ...(settingsInput.userSet ?? []),
    ])].filter((field) => !resetFields.has(field));
    const shouldRecompute = input.topic !== undefined
      || input.description !== undefined
      || explicitBriefFields.length > 0
      || nestedBriefFields.length > 0
      || input.title !== undefined
      || resetFields.size > 0;

    if (shouldRecompute) {
      const resolved = recommendBrief({
        topic: input.topic ?? current.topic,
        description: input.description ?? current.description,
        title: userSet.includes("title") ? (input.title ?? current.title) : undefined,
        mode: input.mode ?? current.mode,
        settings: { ...settings, userSet },
      });
      updates.title = resolved.values.title;
      updates.topic = input.topic ?? current.topic;
      updates.settings = {
        ...settings,
        ...resolved.values.settings,
        researchMode: settings.researchMode,
        stageExecutors: settings.stageExecutors,
        llm: settings.llm,
        autoRender: settings.autoRender,
        userSet,
      };
    } else if (input.title !== undefined) {
      updates.title = input.title;
    }

    if (input.topic !== undefined) updates.topic = input.topic;
    if (hasSettingsUpdate && !shouldRecompute) updates.settings = settings;

    await db.update(projects).set(updates).where(eq(projects.id, id)).run();
    return getProject(id);
  }

  async function listProjects(query: ProjectListQuery): Promise<ProjectListResponse> {
    const conditions = [];
    if (query.archivedOnly) {
      conditions.push(isNotNull(projects.archivedAt));
    } else if (!query.includeArchived) {
      conditions.push(isNull(projects.archivedAt));
    }
    if (query.status?.length) {
      conditions.push(inArray(projects.status, query.status));
    }
    if (query.q) {
      const escapedQuery = query.q.replace(/[\\%_]/g, "\\$&");
      const pattern = `%${escapedQuery}%`;
      const containsQuery = sql`( ${projects.title} LIKE ${pattern} ESCAPE '\\' COLLATE NOCASE
        OR ${projects.topic} LIKE ${pattern} ESCAPE '\\' COLLATE NOCASE
        OR ${projects.description} LIKE ${pattern} ESCAPE '\\' COLLATE NOCASE )`;
      conditions.push(containsQuery);
    }
    if (query.profileId) {
      conditions.push(eq(projects.profileId, query.profileId));
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = query.sort === "title"
      ? sql`lower(${projects.title})`
      : query.sort === "createdAt"
        ? projects.createdAt
        : projects.updatedAt;
    const direction = query.order === "asc" ? asc : desc;

    const [items, totalRows] = await Promise.all([
      db.select()
        .from(projects)
        .where(where)
        .orderBy(direction(sortColumn), asc(projects.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .all(),
      db.select({ total: count() }).from(projects).where(where).get(),
    ]);

    return {
      items: items.map(toProject),
      total: totalRows?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async function duplicateProject(id: string): Promise<Project | undefined> {
    const source = await getProject(id);
    if (!source) return undefined;
    return createProject({
      title: `${source.title} (copy)`,
      topic: source.topic,
      description: source.description,
      mode: source.mode,
      settings: source.settings,
      ...(source.profileId ? { profileId: source.profileId } : {}),
    });
  }

  async function setArchived(id: string, archived: boolean): Promise<Project | undefined> {
    const current = await getProject(id);
    if (!current) return undefined;
    if (archived && current.archivedAt !== null) return current;
    if (!archived && current.archivedAt === null) return current;

    await db.update(projects)
      .set({
        archivedAt: archived ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, id))
      .run();
    return getProject(id);
  }

  async function deleteProject(id: string): Promise<"not_found" | "busy" | "deleted"> {
    const project = await getProject(id);
    if (!project) return "not_found";
    const activeJob = await db.select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.projectId, id), inArray(jobs.status, ["QUEUED", "RUNNING"])))
      .get();
    if (activeJob || project.status === "GENERATING" || project.status === "RENDERING") return "busy";

    await db.update(projects).set({ parentProjectId: null, updatedAt: new Date().toISOString() }).where(eq(projects.parentProjectId, id)).run();
    await db.delete(projects).where(eq(projects.id, id)).run();
    try {
      removeProjectDir(config.DATA_DIR, id);
    } catch (error) {
      logger.warn({ err: error, projectId: id }, "Failed to remove project directory after deleting project");
    }
    return "deleted";
  }

  async function dashboardStats(): Promise<DashboardStats> {
    const [statusCounts, archivedRow, recentRows, failedJobs] = await Promise.all([
      db.select({ status: projects.status, total: count() })
        .from(projects)
        .where(isNull(projects.archivedAt))
        .groupBy(projects.status)
        .all(),
      db.select({ total: count() })
        .from(projects)
        .where(isNotNull(projects.archivedAt))
        .get(),
      db.select()
        .from(projects)
        .where(isNull(projects.archivedAt))
        .orderBy(desc(projects.updatedAt), asc(projects.id))
        .limit(5)
        .all(),
      db.select({
        jobId: jobs.id,
        projectId: jobs.projectId,
        projectTitle: projects.title,
        stage: jobs.stage,
        error: jobs.error,
        at: jobs.finishedAt,
      })
        .from(jobs)
        .innerJoin(projects, eq(jobs.projectId, projects.id))
        .where(eq(jobs.status, "FAILED"))
        .orderBy(desc(jobs.finishedAt), desc(jobs.createdAt))
        .limit(10)
        .all(),
    ]);

    const byStatus: Record<(typeof PROJECT_STATUSES)[number], number> = {
      DRAFT: 0,
      GENERATING: 0,
      REVIEW: 0,
      RENDERING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };
    for (const row of statusCounts) {
      const status = ProjectStatusSchema.safeParse(row.status);
      if (status.success) {
        byStatus[status.data] = row.total;
      }
    }

    return {
      total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
      byStatus,
      archived: archivedRow?.total ?? 0,
      recent: recentRows.map(toProject),
      recentErrors: failedJobs.map((job) => {
        const error = job.error as { code: string; message: string } | null;
        return {
          jobId: job.jobId,
          projectId: job.projectId,
          projectTitle: job.projectTitle,
          stage: PipelineStageSchema.parse(job.stage),
          code: error?.code ?? "JOB_FAILED",
          message: error?.message ?? "Job failed without an error message",
          at: job.at ?? new Date().toISOString(),
        };
      }),
    };
  }

  return {
    createProject,
    getProject,
    updateProject,
    listProjects,
    duplicateProject,
    setArchived,
    deleteProject,
    dashboardStats,
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;

export async function requireProject(service: ProjectService, id: string): Promise<Project> {
  const project = await service.getProject(id);
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
}
