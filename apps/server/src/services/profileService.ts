import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import {
  LlmSettingsSchema,
  ProfileDefaultBriefSchema,
  ProfileDetailSchema,
  ProfileListItemSchema,
  ProfileSchema,
  PlatformAccountSchema,
  PublishSettingsSchema,
  mainAspectFromFormats,
  resolveAccountFormat,
  type AccountFormat,
  type PlatformAccount,
  type PlatformAccountInput,
  type PlatformAccountUpdate,
  type Profile,
  type ProfileDetail,
  type ProfileInput,
  type ProfileListItem,
  type ProfileListQuery,
  type ProfileListResponse,
  type ProfileUpdate,
  type ProjectSettingsInput,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppDatabase } from "../db/client.js";
import { platformAccounts, profiles, projects, type PlatformAccountRow, type ProfileRow } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { normalizeGuidelineSettings } from "../guidelines/settings.js";

function toProfile(row: ProfileRow): Profile {
  return ProfileSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    direction: row.direction,
    language: row.language,
    defaultBrief: row.defaultBrief,
    voice: row.voice ?? null,
    guidelines: row.guidelines,
    llm: row.llm ?? null,
    avatarPath: row.avatarPath ?? null,
    color: row.color,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toAccount(row: PlatformAccountRow): PlatformAccount {
  return PlatformAccountSchema.parse({
    id: row.id,
    profileId: row.profileId,
    platform: row.platform,
    displayName: row.displayName,
    handle: row.handle ?? null,
    externalId: row.externalId ?? null,
    format: row.format,
    enabled: row.enabled,
    connection: row.connection,
    connectionError: row.connectionError ?? null,
    lastCheckedAt: row.lastCheckedAt ?? null,
    publishSettings: row.publishSettings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function normalizeLlm(value: ProfileInput["llm"] | ProfileUpdate["llm"]): Profile["llm"] {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return LlmSettingsSchema.parse({
    ...value,
    tasks: Object.fromEntries(Object.entries(value.tasks ?? {}).filter(([, route]) => route !== null)),
  });
}

export function createProfileService(db: AppDatabase) {
  async function getProfile(id: string): Promise<Profile | undefined> {
    const row = await db.select().from(profiles).where(eq(profiles.id, id)).get();
    return row ? toProfile(row) : undefined;
  }

  async function requireProfile(id: string): Promise<Profile> {
    const profile = await getProfile(id);
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found");
    return profile;
  }

  async function listAccounts(profileId: string): Promise<PlatformAccount[]> {
    const rows = await db.select()
      .from(platformAccounts)
      .where(eq(platformAccounts.profileId, profileId))
      .orderBy(asc(platformAccounts.createdAt), asc(platformAccounts.id))
      .all();
    return rows.map(toAccount);
  }

  async function getDetail(id: string): Promise<ProfileDetail> {
    const profile = await requireProfile(id);
    const accounts = await listAccounts(id);
    const projectCountRow = await db.select({ total: count() })
      .from(projects)
      .where(eq(projects.profileId, id))
      .get();
    return ProfileDetailSchema.parse({
      ...profile,
      accounts,
      projectCount: projectCountRow?.total ?? 0,
    });
  }

  async function listProfiles(query: ProfileListQuery): Promise<ProfileListResponse> {
    const conditions = query.includeArchived ? undefined : isNull(profiles.archivedAt);
    const rows = await db.select()
      .from(profiles)
      .where(conditions)
      .orderBy(desc(profiles.updatedAt), asc(profiles.name))
      .all();

    const items: ProfileListItem[] = [];
    for (const row of rows) {
      const profile = toProfile(row);
      const accounts = await listAccounts(profile.id);
      const projectCountRow = await db.select({ total: count() })
        .from(projects)
        .where(eq(projects.profileId, profile.id))
        .get();
      items.push(ProfileListItemSchema.parse({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        direction: profile.direction,
        language: profile.language,
        color: profile.color,
        avatarPath: profile.avatarPath,
        archivedAt: profile.archivedAt,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        accountCount: accounts.length,
        projectCount: projectCountRow?.total ?? 0,
        accounts: accounts.map((account) => ({
          id: account.id,
          platform: account.platform,
          displayName: account.displayName,
          handle: account.handle,
          format: account.format,
          enabled: account.enabled,
          connection: account.connection,
        })),
      }));
    }
    return { items };
  }

  async function createProfile(input: ProfileInput): Promise<ProfileDetail> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const defaultBrief = ProfileDefaultBriefSchema.parse(input.defaultBrief ?? {});
    const guidelines = input.guidelines
      ? normalizeGuidelineSettings(input.guidelines)
      : { platformPack: "auto" as const, customRules: [] as string[] };
    const llm = normalizeLlm(input.llm) ?? null;

    try {
      await db.insert(profiles).values({
        id,
        name: input.name,
        description: input.description ?? "",
        direction: input.direction ?? "",
        language: input.language ?? defaultBrief.language,
        defaultBrief,
        voice: input.voice === undefined ? null : input.voice,
        guidelines,
        llm,
        avatarPath: input.avatarPath ?? null,
        color: input.color ?? "#3B82F6",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE") || message.includes("unique")) {
        throw new AppError(409, "PROFILE_NAME_TAKEN", "A profile with this name already exists");
      }
      throw error;
    }
    return getDetail(id);
  }

  async function updateProfile(id: string, input: ProfileUpdate): Promise<ProfileDetail> {
    const current = await requireProfile(id);
    const updates: Partial<ProfileRow> = { updatedAt: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.direction !== undefined) updates.direction = input.direction;
    if (input.language !== undefined) updates.language = input.language;
    if (input.color !== undefined) updates.color = input.color;
    if (input.avatarPath !== undefined) updates.avatarPath = input.avatarPath;
    if (input.voice !== undefined) updates.voice = input.voice;
    if (input.defaultBrief !== undefined) {
      updates.defaultBrief = ProfileDefaultBriefSchema.parse({
        ...current.defaultBrief,
        ...input.defaultBrief,
        subtitles: { ...current.defaultBrief.subtitles, ...input.defaultBrief.subtitles },
        music: { ...current.defaultBrief.music, ...input.defaultBrief.music },
        budget: {
          ...current.defaultBrief.budget,
          ...input.defaultBrief.budget,
          features: {
            ...current.defaultBrief.budget.features,
            ...input.defaultBrief.budget?.features,
          },
        },
      });
    }
    if (input.guidelines !== undefined) {
      updates.guidelines = normalizeGuidelineSettings(input.guidelines, current.guidelines);
    }
    if (input.llm !== undefined) {
      updates.llm = input.llm === null ? null : (normalizeLlm(input.llm) ?? null);
    }

    try {
      await db.update(profiles).set(updates).where(eq(profiles.id, id)).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE") || message.includes("unique")) {
        throw new AppError(409, "PROFILE_NAME_TAKEN", "A profile with this name already exists");
      }
      throw error;
    }
    return getDetail(id);
  }

  async function setArchived(id: string, archived: boolean): Promise<ProfileDetail> {
    const current = await requireProfile(id);
    if (archived && current.archivedAt !== null) return getDetail(id);
    if (!archived && current.archivedAt === null) return getDetail(id);
    await db.update(profiles)
      .set({
        archivedAt: archived ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(profiles.id, id))
      .run();
    return getDetail(id);
  }

  async function addAccount(profileId: string, input: PlatformAccountInput): Promise<PlatformAccount> {
    await requireProfile(profileId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const format = resolveAccountFormat(input.platform, input.format);
    const publishSettings = PublishSettingsSchema.parse(input.publishSettings ?? {});
    await db.insert(platformAccounts).values({
      id,
      profileId,
      platform: input.platform,
      displayName: input.displayName,
      handle: input.handle ?? null,
      format,
      enabled: input.enabled ?? true,
      connection: "NOT_CONNECTED",
      connectionError: null,
      publishSettings,
      createdAt: now,
      updatedAt: now,
    }).run();
    await db.update(profiles).set({ updatedAt: now }).where(eq(profiles.id, profileId)).run();
    const row = await db.select().from(platformAccounts).where(eq(platformAccounts.id, id)).get();
    if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create platform account");
    return toAccount(row);
  }

  async function updateAccount(
    profileId: string,
    accountId: string,
    input: PlatformAccountUpdate,
  ): Promise<PlatformAccount> {
    await requireProfile(profileId);
    const row = await db.select()
      .from(platformAccounts)
      .where(and(eq(platformAccounts.id, accountId), eq(platformAccounts.profileId, profileId)))
      .get();
    if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");

    const updates: Partial<PlatformAccountRow> = { updatedAt: new Date().toISOString() };
    if (input.displayName !== undefined) updates.displayName = input.displayName;
    if (input.handle !== undefined) updates.handle = input.handle;
    if (input.format !== undefined) updates.format = input.format;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.publishSettings !== undefined) {
      updates.publishSettings = PublishSettingsSchema.parse({
        ...row.publishSettings,
        ...input.publishSettings,
      });
    }
    await db.update(platformAccounts)
      .set(updates)
      .where(eq(platformAccounts.id, accountId))
      .run();
    await db.update(profiles).set({ updatedAt: updates.updatedAt! }).where(eq(profiles.id, profileId)).run();
    const updated = await db.select().from(platformAccounts).where(eq(platformAccounts.id, accountId)).get();
    if (!updated) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    return toAccount(updated);
  }

  async function deleteAccount(profileId: string, accountId: string): Promise<void> {
    await requireProfile(profileId);
    const row = await db.select()
      .from(platformAccounts)
      .where(and(eq(platformAccounts.id, accountId), eq(platformAccounts.profileId, profileId)))
      .get();
    if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    if (row.connection !== "NOT_CONNECTED") {
      throw new AppError(409, "ACCOUNT_CONNECTED", "Connected accounts cannot be deleted. Disconnect first.");
    }
    await db.delete(platformAccounts).where(eq(platformAccounts.id, accountId)).run();
    await db.update(profiles).set({ updatedAt: new Date().toISOString() }).where(eq(profiles.id, profileId)).run();
  }

  async function getDirectionForProject(profileId: string | null | undefined): Promise<string | undefined> {
    if (!profileId) return undefined;
    const row = await db.select({ direction: profiles.direction })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get();
    return row?.direction?.trim() || undefined;
  }

  /** Settings seed + mode/autoRender/aspect from a profile for new projects. Request overrides applied by caller. */
  async function settingsSeedFromProfile(profileId: string): Promise<{
    settings: ProjectSettingsInput;
    mode?: Profile["defaultBrief"]["mode"];
    formats: AccountFormat[];
  }> {
    const profile = await requireProfile(profileId);
    const accounts = await listAccounts(profileId);
    const brief = profile.defaultBrief;
    const { mode, autoRender, ...briefSettings } = brief;
    const settings: ProjectSettingsInput = {
      ...briefSettings,
      language: profile.language,
      autoRender,
      ...(profile.voice ? { voice: profile.voice } : {}),
      guidelines: profile.guidelines,
      ...(profile.llm ? { llm: profile.llm } : {}),
    };
    const aspect = mainAspectFromFormats(accounts.map((account) => account.format));
    if (aspect && settings.aspectRatio === undefined) {
      // Prefer derived aspect unless the brief already locked one via userSet later.
      settings.aspectRatio = aspect;
    }
    return {
      settings,
      mode,
      formats: accounts.map((account) => account.format),
    };
  }

  return {
    listProfiles,
    getProfile,
    getDetail,
    createProfile,
    updateProfile,
    setArchived,
    addAccount,
    updateAccount,
    deleteAccount,
    listAccounts,
    getDirectionForProject,
    settingsSeedFromProfile,
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;

/** Sync helper for stage executors that only have better-sqlite3. */
export function getProfileDirection(sqlite: Database.Database, profileId: string | null | undefined): string | undefined {
  if (!profileId) return undefined;
  const row = sqlite.prepare("SELECT direction FROM profiles WHERE id = ?").get(profileId) as { direction?: string } | undefined;
  const text = row?.direction?.trim();
  return text || undefined;
}
