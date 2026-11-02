import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  PROJECT_STATUSES,
  ProjectSchema,
  ProjectStatusSchema,
  type CreateProjectInput,
  type DashboardStats,
  type Project,
  type ProjectListQuery,
  type ProjectListResponse,
  type ProjectSettings,
  type UpdateProjectInput,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppDatabase } from "../db/client.js";
import { projects, type ProjectRow } from "../db/schema.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { createProjectDir, removeProjectDir } from "../storage/paths.js";

const toProject = (row: ProjectRow): Project => ProjectSchema.parse(row);

function mergeSettings(current: ProjectSettings, update: Partial<ProjectSettings>): ProjectSettings {
  return {
    ...current,
    ...update,
    stageExecutors: {
      ...current.stageExecutors,
      ...update.stageExecutors,
    },
  };
}

export function createProjectService(db: AppDatabase, config: AppConfig, logger: FastifyBaseLogger) {
  async function getProject(id: string): Promise<Project | undefined> {
    const row = await db.select().from(projects).where(eq(projects.id, id)).get();
    return row ? toProject(row) : undefined;
  }

  async function createProject(input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const settings: ProjectSettings = {
      language: input.settings.language ?? "vi",
      targetDurationSec: input.settings.targetDurationSec ?? 120,
      aspectRatio: input.settings.aspectRatio ?? "16:9",
      stageExecutors: input.settings.stageExecutors ?? {},
      autoRender: input.settings.autoRender ?? false,
    };
    const project: Project = {
      id,
      title: input.title,
      description: input.description,
      topic: input.topic,
      mode: input.mode,
      settings,
      status: "DRAFT",
      stage: "TOPIC",
      thumbnailPath: null,
      durationSec: null,
      version: 1,
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
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.topic !== undefined) updates.topic = input.topic;
    if (input.mode !== undefined) updates.mode = input.mode;
    if (input.settings !== undefined) updates.settings = mergeSettings(current.settings, input.settings);

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
    if (project.status === "GENERATING" || project.status === "RENDERING") return "busy";

    await db.delete(projects).where(eq(projects.id, id)).run();
    try {
      removeProjectDir(config.DATA_DIR, id);
    } catch (error) {
      logger.warn({ err: error, projectId: id }, "Failed to remove project directory after deleting project");
    }
    return "deleted";
  }

  async function dashboardStats(): Promise<DashboardStats> {
    const [statusCounts, archivedRow, recentRows] = await Promise.all([
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
      recentErrors: [],
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
