import { createHash, randomUUID } from "node:crypto";
import { currentWorkspaceId, scopeCondition } from "../auth/requestContext.js";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  DEFAULT_PROFILE_AUTOMATION,
  DEFAULT_PROFILE_TREND_SETTINGS,
  MarketDefaultFieldSchema,
  marketDefaults,
  ProfileAutomationSchema,
  ProfileDefaultBriefSchema,
  ProfileDetailSchema,
  ProfileListItemSchema,
  ProfileLlmSettingsSchema,
  ProfileSchema,
  ProfileTranslationsSchema,
  ProfileTrendSettingsSchema,
  PlatformAccountSchema,
  PublishSettingsSchema,
  mainAspectFromFormats,
  resolveAccountFormat,
  type AccountFormat,
  type MarketDefaultField,
  type PlatformAccount,
  type PlatformAccountInput,
  type PlatformAccountUpdate,
  type Profile,
  type ProfileAutomation,
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
import { jobs, platformAccounts, profiles, projects, publications, type PlatformAccountRow, type ProfileRow } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { normalizeGuidelineSettings } from "../guidelines/settings.js";
import { marketAccountWarning, requireMarket } from "../knowledge/markets.js";
import { markUserTouch } from "../operator/autopilot.js";

function parseAutomation(value: ProfileAutomation | null | undefined): ProfileAutomation {
  return ProfileAutomationSchema.parse(value ?? DEFAULT_PROFILE_AUTOMATION);
}

function toProfile(row: ProfileRow): Profile {
  return ProfileSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    direction: row.direction,
    language: row.language,
    market: row.market,
    defaultBrief: row.defaultBrief,
    voice: row.voice ?? null,
    guidelines: row.guidelines,
    llm: row.llm ?? null,
    automation: parseAutomation(row.automation),
    trendSettings: ProfileTrendSettingsSchema.parse(row.trendSettings ?? {}),
    translations: ProfileTranslationsSchema.parse(row.translations ?? []),
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
  return ProfileLlmSettingsSchema.parse({
    ...value,
    tasks: Object.fromEntries(Object.entries(value.tasks ?? {}).filter(([, route]) => route !== null)),
  });
}

export function createProfileService(db: AppDatabase, onKnowledgeChange: (id:string)=>void = ()=>{}) {
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const fieldKey = (id: string, field: MarketDefaultField) => `profile:${id}:market-default:${field}`;

  function postingPlatforms(profile: Profile, accounts: Pick<PlatformAccount, "id" | "platform" | "enabled">[]) {
    const selected = profile.automation.accountIds;
    const platforms = accounts.filter((account) => account.enabled && (!selected || selected.includes(account.id)))
      .map((account) => account.platform);
    if (accounts.length) return platforms;
    return platformsForBrief(profile.defaultBrief.platform);
  }

  function platformsForBrief(platform: Profile["defaultBrief"]["platform"]): PlatformAccount["platform"][] {
    if (platform === "custom") return [];
    return [platform === "youtube_shorts" ? "youtube" : platform];
  }

  function marketFields(profile: Profile) {
    return {
      language: profile.language, timezone: profile.automation.timezone, publishTimes: profile.automation.publishTimes,
      "trendSettings.region": profile.trendSettings?.region ?? DEFAULT_PROFILE_TREND_SETTINGS.region,
      "trendSettings.language": profile.trendSettings?.language ?? DEFAULT_PROFILE_TREND_SETTINGS.language,
    };
  }

  function preview(profile: Profile, code: string, platforms: PlatformAccount["platform"][]) {
    const { pack } = requireMarket(sqlite, code);
    const defaults = marketDefaults(pack, platforms, profile.automation.videosPerDay)!;
    const current = marketFields(profile);
    const suggested = {
      language: defaults.language,
      timezone: defaults.timezone,
      publishTimes: defaults.publishTimes ?? current.publishTimes,
      "trendSettings.region": defaults.trendSettings.region ?? current["trendSettings.region"],
      "trendSettings.language": defaults.trendSettings.language,
    };
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const touched = sqlite.prepare("SELECT 1 FROM operator_user_touches WHERE object_key=? AND touched_at>=?");
    const changes = MarketDefaultFieldSchema.options.flatMap((field) => JSON.stringify(current[field]) === JSON.stringify(suggested[field])
      ? [] : [{ field, from: current[field], to: suggested[field], recentlyEdited: Boolean(touched.get(fieldKey(profile.id, field), cutoff)) }]);
    const previewToken = createHash("sha256").update(JSON.stringify([profile.id, profile.market, code, current, changes])).digest("hex");
    return { current, suggested, changes, previewToken };
  }

  async function previewMarketDefaults(id: string, code: string) {
    const profile = await requireProfile(id);
    return preview(profile, code, postingPlatforms(profile, await listAccounts(id)));
  }

  async function applyMarketDefaults(id: string, code: string, fields: MarketDefaultField[], expectedToken?: string) {
    db.transaction((tx) => {
      const row = tx.select().from(profiles).where(eq(profiles.id, id)).get();
      if (!row) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found");
      const profile = toProfile(row);
      const accounts = tx.select({ id: platformAccounts.id, platform: platformAccounts.platform, enabled: platformAccounts.enabled }).from(platformAccounts)
        .where(eq(platformAccounts.profileId, id))
        .orderBy(asc(platformAccounts.createdAt), asc(platformAccounts.id)).all();
      const { suggested, changes, previewToken } = preview(profile, code, postingPlatforms(profile, accounts));
      if (expectedToken && expectedToken !== previewToken) {
        throw new AppError(409, "MARKET_PREVIEW_CHANGED", "Đề xuất đã thay đổi. Hãy kiểm tra lại trước khi áp dụng.");
      }
      const selected = new Set(changes.filter(({ field }) => fields.includes(field)).map(({ field }) => field));
      const use = <K extends MarketDefaultField>(field: K) => selected.has(field) ? suggested[field] : undefined;
      const timezone = use("timezone");
      const publishTimes = use("publishTimes");
      const region = use("trendSettings.region");
      const trendLanguage = use("trendSettings.language");
      const language = use("language");
      tx.update(profiles).set({
        market: code,
        updatedAt: new Date().toISOString(),
        ...(language === undefined ? {} : { language }),
        ...(timezone === undefined && publishTimes === undefined ? {} : {
          automation: ProfileAutomationSchema.parse({ ...profile.automation,
            ...(timezone === undefined ? {} : { timezone }), ...(publishTimes === undefined ? {} : { publishTimes }) }),
        }),
        ...(region === undefined && trendLanguage === undefined ? {} : {
          trendSettings: ProfileTrendSettingsSchema.parse({ ...profile.trendSettings,
            ...(region === undefined ? {} : { region }), ...(trendLanguage === undefined ? {} : { language: trendLanguage }) }),
        }),
      }).where(eq(profiles.id, id)).run();
      markUserTouch(sqlite, `profile:${id}:market`);
      if (timezone !== undefined || publishTimes !== undefined) markUserTouch(sqlite, `profile:${id}:automation`);
    }, { behavior: "immediate" });
    return getDetail(id);
  }

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
    const scoped = scopeCondition(profiles.workspaceId, profiles.id);
    const base = query.includeArchived ? undefined : isNull(profiles.archivedAt);
    const conditions = scoped && base ? and(base, scoped) : (scoped ?? base);
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
    const defaults = input.market ? marketDefaults(requireMarket(sqlite, input.market).pack,
      platformsForBrief(input.defaultBrief?.platform ?? "youtube"), input.automation?.videosPerDay ?? DEFAULT_PROFILE_AUTOMATION.videosPerDay) : null;
    const language = input.language ?? input.defaultBrief?.language ?? defaults?.language;
    const defaultBrief = ProfileDefaultBriefSchema.parse({
      ...(defaults ? { language } : {}),
      ...input.defaultBrief,
    });
    const guidelines = input.guidelines
      ? normalizeGuidelineSettings(input.guidelines)
      : { platformPack: "auto" as const, customRules: [] as string[] };
    const llm = normalizeLlm(input.llm) ?? null;
    const automation = ProfileAutomationSchema.parse({
      ...DEFAULT_PROFILE_AUTOMATION,
      ...(defaults ? { timezone: defaults.timezone, publishTimes: defaults.publishTimes ?? DEFAULT_PROFILE_AUTOMATION.publishTimes } : {}),
      ...input.automation,
    });

    try {
      await db.insert(profiles).values({
        id,
        workspaceId: currentWorkspaceId(sqlite),
        name: input.name,
        description: input.description ?? "",
        direction: input.direction ?? "",
        language: language ?? defaultBrief.language,
        market: input.market ?? null,
        defaultBrief,
        voice: input.voice === undefined ? null : input.voice,
        guidelines,
        llm,
        automation,
        trendSettings: input.trendSettings || defaults ? ProfileTrendSettingsSchema.parse({
          ...(defaults ? { region: defaults.trendSettings.region ?? undefined, language: defaults.trendSettings.language } : {}),
          ...input.trendSettings,
        }) : null,
        translations: input.translations ? ProfileTranslationsSchema.parse(input.translations) : null,
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
    const { setVisualQuality } = await import("./visualPolicy.js");
    setVisualQuality((db as unknown as { $client: Database.Database }).$client, id, "best", new Date(now));
    onKnowledgeChange(id);
    return getDetail(id);
  }

  async function updateProfile(id: string, input: ProfileUpdate, ownerEdit = false): Promise<ProfileDetail> {
    const current = await requireProfile(id);
    const updates: Partial<ProfileRow> = { updatedAt: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.direction !== undefined) updates.direction = input.direction;
    if (input.language !== undefined) updates.language = input.language;
    if (input.market !== undefined) {
      if (input.market !== null) requireMarket(sqlite, input.market);
      updates.market = input.market;
    }
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
    if (input.automation !== undefined) {
      updates.automation = ProfileAutomationSchema.parse({
        ...current.automation,
        ...input.automation,
      });
    }
    if (input.trendSettings !== undefined) {
      updates.trendSettings = ProfileTrendSettingsSchema.parse({
        ...(current.trendSettings ?? {}),
        ...input.trendSettings,
        feeds: input.trendSettings.feeds ?? current.trendSettings?.feeds,
        metaPages: input.trendSettings.metaPages ?? current.trendSettings?.metaPages,
      });
    }
    if (input.translations !== undefined) {
      updates.translations = ProfileTranslationsSchema.parse(input.translations);
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
    const result = await getDetail(id);
    if (ownerEdit) {
      if (input.market !== undefined && current.market !== result.market) markUserTouch(sqlite, `profile:${id}:market`);
      const before = marketFields(current);
      const after = marketFields(result);
      for (const field of MarketDefaultFieldSchema.options) {
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) markUserTouch(sqlite, fieldKey(id, field));
      }
    }
    return result;
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
    const profile = await requireProfile(profileId);
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
    const warning = marketAccountWarning(sqlite, profile.market, input.platform);
    return warning ? { ...toAccount(row), marketWarning: warning } : toAccount(row);
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

  async function deleteAccount(profileId: string, accountId: string, unfinishedOnly = false): Promise<void> {
    await requireProfile(profileId);
    const row = await db.select()
      .from(platformAccounts)
      .where(and(eq(platformAccounts.id, accountId), eq(platformAccounts.profileId, profileId)))
      .get();
    if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    db.transaction((tx) => {
      const match = and(eq(platformAccounts.id, accountId), eq(platformAccounts.profileId, profileId),
        unfinishedOnly ? inArray(platformAccounts.connection, ["NOT_CONNECTED", "ERROR"]) : undefined);
      if (!tx.select({ id: platformAccounts.id }).from(platformAccounts).where(match).get()) return;
      const related = tx.select({ id: publications.id }).from(publications).where(eq(publications.accountId, accountId));
      if (tx.select({ id: jobs.id }).from(jobs)
        .where(and(eq(jobs.stage, "PUBLISH"), eq(jobs.status, "RUNNING"), inArray(jobs.scope, related))).get()) {
        throw new AppError(409, "ACCOUNT_BUSY", "Tài khoản đang đăng video. Hãy chờ xong rồi xoá.");
      }
      const now = new Date().toISOString();
      tx.update(jobs).set({ status: "CANCELLED", finishedAt: now, message: "Tài khoản đã bị xoá" })
        .where(and(eq(jobs.stage, "PUBLISH"), eq(jobs.status, "QUEUED"), inArray(jobs.scope, related))).run();
      tx.delete(platformAccounts).where(match).run();
      tx.update(profiles).set({ updatedAt: now }).where(eq(profiles.id, profileId)).run();
    });
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
      ...(profile.market ? { market: profile.market } : {}),
      autoRender,
      ...(profile.voice ? { voice: profile.voice } : {}),
      guidelines: profile.guidelines,
      ...(profile.llm ? {
        llm: {
          ...(profile.llm.default ? { default: profile.llm.default } : {}),
          ...(profile.llm.tasks ? { tasks: profile.llm.tasks } : {}),
        },
      } : {}),
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
    previewMarketDefaults,
    applyMarketDefaults,
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;

/** Sync helper for stage executors that only have better-sqlite3. */
export function getProfileDirection(sqlite: Database.Database, profileId: string | null | undefined): string | undefined {
  return getProfilePromptContext(sqlite, profileId).direction;
}

export type ProfilePromptContext = {
  direction?: string;
  learnedNotes?: string;
  topicAngles: string[];
  avoid: string[];
  titleAbTest: boolean;
};

/** Direction stays the user's text. Learned notes are a separate block for prompts. */
export function getProfilePromptContext(
  sqlite: Database.Database,
  profileId: string | null | undefined,
): ProfilePromptContext {
  const empty: ProfilePromptContext = { topicAngles: [], avoid: [], titleAbTest: false };
  if (!profileId) return empty;
  const row = sqlite.prepare(
    "SELECT direction, learned_notes, learned_hints, title_ab_test FROM profiles WHERE id = ?",
  ).get(profileId) as {
    direction?: string;
    learned_notes?: string | null;
    learned_hints?: string | { topicAngles?: unknown; avoid?: unknown } | null;
    title_ab_test?: number | boolean | null;
  } | undefined;
  if (!row) return empty;
  const hints = typeof row.learned_hints === "string"
    ? JSON.parse(row.learned_hints) as { topicAngles?: unknown; avoid?: unknown }
    : row.learned_hints ?? {};
  const strings = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  const direction = row.direction?.trim() || undefined;
  const learnedNotes = row.learned_notes?.trim() || undefined;
  return {
    ...(direction ? { direction } : {}),
    ...(learnedNotes ? { learnedNotes } : {}),
    topicAngles: strings(hints?.topicAngles),
    avoid: strings(hints?.avoid),
    titleAbTest: Boolean(row.title_ab_test),
  };
}
