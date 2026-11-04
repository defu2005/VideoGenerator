import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ProfileTopicSchema,
  SuggestTopicsResponseSchema,
  TopicListResponseSchema,
  TopicSuggestOutputSchema,
  dedupeTopicSuggestions,
  type ApproveTopicsBody,
  type ProfileTopic,
  type ProfileTopicInput,
  type ProfileTopicUpdate,
  type ReorderTopicsBody,
  type SuggestTopicsBody,
  type SuggestTopicsResponse,
  type TopicListQuery,
  type TopicListResponse,
  type TopicStatus,
} from "@vg/shared";
import type { AppDatabase } from "../db/client.js";
import { profileTopics, type ProfileTopicRow } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ProfileService } from "./profileService.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmCache } from "../providers/llm/cache.js";

function toTopic(row: ProfileTopicRow): ProfileTopic {
  return ProfileTopicSchema.parse({
    id: row.id,
    profileId: row.profileId,
    topic: row.topic,
    notes: row.notes ?? null,
    source: row.source,
    status: row.status,
    priority: row.priority,
    projectId: row.projectId ?? null,
    scheduledFor: row.scheduledFor ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function createTopicService(
  db: AppDatabase,
  sqlite: Database.Database,
  profilesService: ProfileService,
  llm: LlmProviderRegistry,
) {
  async function requireProfile(profileId: string) {
    return profilesService.getDetail(profileId);
  }

  async function listTopics(profileId: string, query: TopicListQuery = {}): Promise<TopicListResponse> {
    await requireProfile(profileId);
    const conditions = query.status
      ? and(eq(profileTopics.profileId, profileId), eq(profileTopics.status, query.status))
      : eq(profileTopics.profileId, profileId);
    const rows = await db.select()
      .from(profileTopics)
      .where(conditions)
      .orderBy(desc(profileTopics.priority), asc(profileTopics.createdAt), asc(profileTopics.id))
      .all();
    return TopicListResponseSchema.parse({ items: rows.map(toTopic) });
  }

  async function nextPriority(profileId: string): Promise<number> {
    const row = await db.select({
      max: sql<number>`coalesce(max(${profileTopics.priority}), 0)`,
    }).from(profileTopics).where(eq(profileTopics.profileId, profileId)).get();
    return (row?.max ?? 0) + 1;
  }

  async function addTopic(profileId: string, input: ProfileTopicInput): Promise<ProfileTopic> {
    const profile = await requireProfile(profileId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const priority = input.priority ?? await nextPriority(profileId);
    const status: TopicStatus = input.status
      ?? (profile.automation.autoApproveTopics ? "APPROVED" : "PENDING");
    await db.insert(profileTopics).values({
      id,
      profileId,
      topic: input.topic,
      notes: input.notes ?? null,
      source: "USER",
      status,
      priority,
      projectId: null,
      scheduledFor: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }).run();
    const row = await db.select().from(profileTopics).where(eq(profileTopics.id, id)).get();
    if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create topic");
    return toTopic(row);
  }

  async function updateTopic(
    profileId: string,
    topicId: string,
    input: ProfileTopicUpdate,
  ): Promise<ProfileTopic> {
    await requireProfile(profileId);
    const row = await db.select()
      .from(profileTopics)
      .where(and(eq(profileTopics.id, topicId), eq(profileTopics.profileId, profileId)))
      .get();
    if (!row) throw new AppError(404, "TOPIC_NOT_FOUND", "Topic not found");
    if (row.status === "IN_PRODUCTION" || row.status === "DONE") {
      if (input.status && input.status !== row.status) {
        throw new AppError(409, "TOPIC_LOCKED", "Cannot change status of a topic already in production or done");
      }
    }
    const updates: Partial<ProfileTopicRow> = { updatedAt: new Date().toISOString() };
    if (input.topic !== undefined) updates.topic = input.topic;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.status !== undefined) updates.status = input.status;
    if (input.priority !== undefined) updates.priority = input.priority;
    await db.update(profileTopics).set(updates).where(eq(profileTopics.id, topicId)).run();
    const updated = await db.select().from(profileTopics).where(eq(profileTopics.id, topicId)).get();
    if (!updated) throw new AppError(404, "TOPIC_NOT_FOUND", "Topic not found");
    return toTopic(updated);
  }

  async function approveTopics(profileId: string, body: ApproveTopicsBody): Promise<TopicListResponse> {
    await requireProfile(profileId);
    const now = new Date().toISOString();
    const rows = await db.select()
      .from(profileTopics)
      .where(and(
        eq(profileTopics.profileId, profileId),
        inArray(profileTopics.id, body.ids),
      ))
      .all();
    for (const row of rows) {
      if (row.status !== "PENDING" && row.status !== "APPROVED" && row.status !== "REJECTED") continue;
      await db.update(profileTopics)
        .set({ status: body.status, updatedAt: now, error: null })
        .where(eq(profileTopics.id, row.id))
        .run();
    }
    return listTopics(profileId);
  }

  async function reorderTopics(profileId: string, body: ReorderTopicsBody): Promise<TopicListResponse> {
    await requireProfile(profileId);
    const now = new Date().toISOString();
    // Highest priority first in orderedIds[0].
    const total = body.orderedIds.length;
    for (let index = 0; index < body.orderedIds.length; index += 1) {
      const id = body.orderedIds[index]!;
      await db.update(profileTopics)
        .set({ priority: total - index, updatedAt: now })
        .where(and(eq(profileTopics.id, id), eq(profileTopics.profileId, profileId)))
        .run();
    }
    return listTopics(profileId);
  }

  async function pastTopicTexts(profileId: string, limit = 50): Promise<string[]> {
    // Guide: last 50 topics (done, rejected and pending — include all statuses to avoid repeats).
    const all = await db.select({ topic: profileTopics.topic })
      .from(profileTopics)
      .where(eq(profileTopics.profileId, profileId))
      .orderBy(desc(profileTopics.updatedAt))
      .limit(limit)
      .all();
    return all.map((row) => row.topic);
  }

  async function suggestTopics(
    profileId: string,
    body: SuggestTopicsBody,
    signal?: AbortSignal,
  ): Promise<SuggestTopicsResponse> {
    const profile = await requireProfile(profileId);
    const past = await pastTopicTexts(profileId, 50);
    const count = body.count ?? 5;
    const routeProject = {
      id: profileId,
      mode: "AUTO" as const,
      settings: {
        language: profile.language,
        llm: profile.llm ?? undefined,
        budget: profile.defaultBrief.budget,
      },
    };
    const appRouting = getAppLlmSettings(sqlite);
    const route = llm.resolveTask("topicSuggest", routeProject as never, appRouting);
    const cache = new LlmCache(sqlite, true);
    const payload = {
      direction: profile.direction,
      language: profile.language,
      hint: body.hint ?? "",
      count,
      pastTopics: past,
    };
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const generated = await generateRoutedStructured({
      registry: llm,
      route,
      task: "topicSuggest",
      system: [
        "You suggest short video topics for a channel.",
        "Respect the channel direction and language.",
        "Do not repeat or closely paraphrase pastTopics.",
        "Each topic needs a one-line angle.",
        "Reply with JSON only.",
      ].join(" "),
      prompt: JSON.stringify(payload),
      schema: TopicSuggestOutputSchema,
      schemaName: "TopicSuggest",
      schemaVersion: "1",
      maxOutputTokens: route.maxOutputTokens ?? 2_048,
      signal: signal ?? new AbortController().signal,
      cache,
      cacheKeyExtra: hash,
    });

    const { kept, rejected } = dedupeTopicSuggestions(generated.value.topics, past);
    const status: TopicStatus = profile.automation.autoApproveTopics ? "APPROVED" : "PENDING";
    const created: ProfileTopic[] = [];
    for (const item of kept.slice(0, count)) {
      const now = new Date().toISOString();
      const id = randomUUID();
      const priority = await nextPriority(profileId);
      await db.insert(profileTopics).values({
        id,
        profileId,
        topic: item.topic,
        notes: item.angle,
        source: "LLM",
        status,
        priority,
        projectId: null,
        scheduledFor: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      }).run();
      const row = await db.select().from(profileTopics).where(eq(profileTopics.id, id)).get();
      if (row) created.push(toTopic(row));
    }
    return SuggestTopicsResponseSchema.parse({
      items: created,
      rejectedDuplicates: rejected,
    });
  }

  async function getTopic(profileId: string, topicId: string): Promise<ProfileTopic> {
    const row = await db.select()
      .from(profileTopics)
      .where(and(eq(profileTopics.id, topicId), eq(profileTopics.profileId, profileId)))
      .get();
    if (!row) throw new AppError(404, "TOPIC_NOT_FOUND", "Topic not found");
    return toTopic(row);
  }

  return {
    listTopics,
    addTopic,
    updateTopic,
    approveTopics,
    reorderTopics,
    suggestTopics,
    getTopic,
    pastTopicTexts,
  };
}

export type TopicService = ReturnType<typeof createTopicService>;

/** Sync helpers used by the automation ticker (better-sqlite3). */
export function listApprovedTopicsSync(sqlite: Database.Database, profileId: string): ProfileTopic[] {
  const rows = sqlite.prepare(
    `SELECT * FROM profile_topics WHERE profile_id = ? AND status = 'APPROVED'
     ORDER BY priority DESC, created_at ASC, id ASC`,
  ).all(profileId) as Array<Record<string, unknown>>;
  return rows.map((row) => mapSyncTopic(row));
}

export function listTopicsWithScheduleSync(sqlite: Database.Database, profileId: string): ProfileTopic[] {
  const rows = sqlite.prepare(
    `SELECT * FROM profile_topics WHERE profile_id = ? AND scheduled_for IS NOT NULL`,
  ).all(profileId) as Array<Record<string, unknown>>;
  return rows.map((row) => mapSyncTopic(row));
}

export function countApprovedTopicsSync(sqlite: Database.Database, profileId: string): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS total FROM profile_topics WHERE profile_id = ? AND status = 'APPROVED'`,
  ).get(profileId) as { total: number };
  return row.total;
}

/** PENDING + APPROVED — supply that can still fill upcoming slots (autoSuggest). */
export function countTopicSupplySync(sqlite: Database.Database, profileId: string): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS total FROM profile_topics
     WHERE profile_id = ? AND status IN ('PENDING', 'APPROVED')`,
  ).get(profileId) as { total: number };
  return row.total;
}

export function countInProductionSync(sqlite: Database.Database): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS total FROM profile_topics WHERE status = 'IN_PRODUCTION'`,
  ).get() as { total: number };
  return row.total;
}

export function listInProductionSync(sqlite: Database.Database): ProfileTopic[] {
  const rows = sqlite.prepare(
    `SELECT * FROM profile_topics WHERE status = 'IN_PRODUCTION'`,
  ).all() as Array<Record<string, unknown>>;
  return rows.map((row) => mapSyncTopic(row));
}

function mapSyncTopic(row: Record<string, unknown>): ProfileTopic {
  return ProfileTopicSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    topic: row.topic,
    notes: row.notes ?? null,
    source: row.source,
    status: row.status,
    priority: row.priority,
    projectId: row.project_id ?? null,
    scheduledFor: row.scheduled_for ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function updateTopicProductionSync(
  sqlite: Database.Database,
  topicId: string,
  patch: {
    status?: TopicStatus;
    projectId?: string | null;
    scheduledFor?: string | null;
    error?: string | null;
  },
): void {
  const now = new Date().toISOString();
  const current = sqlite.prepare("SELECT * FROM profile_topics WHERE id = ?").get(topicId) as
    | Record<string, unknown>
    | undefined;
  if (!current) return;
  sqlite.prepare(
    `UPDATE profile_topics SET
      status = ?, project_id = ?, scheduled_for = ?, error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.status ?? current.status,
    patch.projectId !== undefined ? patch.projectId : current.project_id,
    patch.scheduledFor !== undefined ? patch.scheduledFor : current.scheduled_for,
    patch.error !== undefined ? patch.error : current.error,
    now,
    topicId,
  );
}
