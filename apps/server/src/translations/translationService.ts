import { createHash, randomUUID } from "node:crypto";
import { inheritWorkspace } from "../auth/requestContext.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  ProjectSettingsSchema,
  STAGE_ORDER,
  TRANSLATION_REVIEW_MESSAGE,
  TranslateMetadataRawSchema,
  TranslateScriptOutputSchema,
  TranslationViewSchema,
  buildTimeline,
  buildTranslateScriptPrompt,
  chooseVoice,
  cuesWithoutTimings,
  keepSceneIds,
  resolveBudget,
  sceneNeedsShorten,
  toAss,
  toSrt,
  translationNeedsReview,
  trimMetadata,
  youtubeLanguageExtras,
  type ProfileTranslationTarget,
  type ProjectSettings,
  type TranslationView,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { defaultVoiceFor } from "../lib/defaultVoice.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { LlmCache } from "../providers/llm/cache.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import type { TtsProviderRegistry } from "../providers/tts/registry.js";
import type { ProfileService } from "../services/profileService.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import { createProjectDir, projectDir } from "../storage/paths.js";
import { applyYoutubeLanguageExtras } from "./youtubeExtras.js";

type SceneRow = {
  id: string;
  order: number;
  kind: string;
  label: string;
  narration: string;
  visual_notes: string;
  visual_description: string;
  no_visual: number;
  visual_queries: string;
  music_mood: string;
  energy: string;
  est_duration_sec: number;
  start_sec: number;
  transition_note: string;
  origin: string;
  input_hash: string;
};

type VoiceRow = { scene_id: string; audio_path: string; duration_sec: number };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createTranslationService(deps: {
  sqlite: Database.Database;
  config: AppConfig;
  profiles: ProfileService;
  llm: LlmProviderRegistry;
  tts: TtsProviderRegistry;
  vault: TokenVault;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  function targetsFor(profileId: string | null): ProfileTranslationTarget[] {
    if (!profileId) return [];
    const detail = deps.sqlite.prepare("SELECT translations FROM profiles WHERE id = ?").get(profileId) as { translations: string | null } | undefined;
    if (!detail?.translations) return [];
    const parsed = JSON.parse(detail.translations) as ProfileTranslationTarget[];
    return Array.isArray(parsed) ? parsed : [];
  }

  function parentScenes(projectId: string): SceneRow[] {
    return deps.sqlite.prepare(
      "SELECT * FROM scenes WHERE project_id = ? ORDER BY \"order\" ASC",
    ).all(projectId) as SceneRow[];
  }

  function childRows(parentId: string): Array<{ id: string; title: string; status: string; stage: string; settings: string }> {
    return deps.sqlite.prepare(
      `SELECT id, title, status, stage, settings FROM projects
       WHERE parent_project_id = ? AND kind = 'translation' AND archived_at IS NULL
       ORDER BY created_at ASC`,
    ).all(parentId) as Array<{ id: string; title: string; status: string; stage: string; settings: string }>;
  }

  function waiting(projectId: string): boolean {
    const row = deps.sqlite.prepare(
      "SELECT state, message FROM project_stages WHERE project_id = ? AND stage = 'SCRIPT'",
    ).get(projectId) as { state: string; message: string | null } | undefined;
    return row?.state === "WAITING_USER" && (row.message ?? "").includes(TRANSLATION_REVIEW_MESSAGE);
  }

  function youtubeHints(targets: ProfileTranslationTarget[]): string[] {
    const hints = new Set<string>();
    const accountIds = targets.flatMap((target) => target.accountIds);
    if (accountIds.length === 0) {
      for (const hint of youtubeLanguageExtras([]).hints) hints.add(hint);
      return [...hints];
    }
    for (const accountId of accountIds) {
      const scopes = deps.vault.getCredentialMeta(accountId)?.scopes ?? [];
      for (const hint of youtubeLanguageExtras(scopes).hints) hints.add(hint);
    }
    return [...hints];
  }

  async function view(projectId: string): Promise<TranslationView> {
    const parent = requireParent(projectId, false);
    const targets = targetsFor(parent.profile_id);
    const children = childRows(projectId).map((row) => {
      const settings = JSON.parse(row.settings) as ProjectSettings;
      return {
        id: row.id,
        title: row.title,
        language: settings.language,
        status: row.status,
        stage: row.stage,
        waitingReview: waiting(row.id),
        mode: settings.translation?.mode ?? "dub" as const,
      };
    });
    const reviewChild = children.find((child) => child.waitingReview);
    let review: TranslationView["review"] = null;
    if (reviewChild) {
      const script = deps.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(reviewChild.id) as { data: string } | undefined;
      const data = script ? JSON.parse(script.data) as { sections?: Array<{ id: string; narration: string }> } : null;
      const originals = new Map(parentScenes(projectId).map((scene) => [scene.id, scene.narration]));
      review = {
        childId: reviewChild.id,
        language: reviewChild.language,
        scenes: (data?.sections ?? []).map((section) => ({
          id: section.id,
          original: originals.get(section.id) ?? "",
          translated: section.narration,
        })),
      };
    }
    return TranslationViewSchema.parse({
      targets,
      children,
      review,
      youtubeHints: youtubeHints(targets),
    });
  }

  function requireParent(projectId: string, finished: boolean): {
    id: string;
    title: string;
    topic: string;
    description: string;
    mode: string;
    settings: string;
    status: string;
    profile_id: string | null;
    thumbnail_path: string | null;
  } {
    const row = deps.sqlite.prepare(
      "SELECT id, title, topic, description, mode, settings, status, profile_id, thumbnail_path, kind FROM projects WHERE id = ?",
    ).get(projectId) as {
      id: string;
      title: string;
      topic: string;
      description: string;
      mode: string;
      settings: string;
      status: string;
      profile_id: string | null;
      thumbnail_path: string | null;
      kind: string;
    } | undefined;
    if (!row) throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án.");
    if (row.kind === "clip" || row.kind === "translation") {
      throw new AppError(409, "NOT_TRANSLATABLE", "Chỉ dịch từ video dài đã hoàn thành.");
    }
    if (finished && row.status !== "COMPLETED") {
      throw new AppError(409, "PROJECT_NOT_FINISHED", "Chỉ tạo bản dịch khi video đã hoàn thành.");
    }
    return row;
  }

  function seedStages(projectId: string): void {
    const at = now().toISOString();
    const insert = deps.sqlite.prepare(
      "INSERT INTO project_stages (project_id, stage, state, progress, message, job_id, updated_at, error) VALUES (?, ?, 'PENDING', 0, NULL, NULL, ?, NULL)",
    );
    for (const stage of STAGE_ORDER) insert.run(projectId, stage, at);
  }

  function setStage(projectId: string, stage: string, state: string, message: string | null): void {
    deps.sqlite.prepare(
      "UPDATE project_stages SET state = ?, progress = ?, message = ?, updated_at = ? WHERE project_id = ? AND stage = ?",
    ).run(state, state === "DONE" || state === "SKIPPED" ? 100 : 0, message, now().toISOString(), projectId, stage);
  }

  async function translateScenes(input: {
    profileId: string;
    language: string;
    budget: ProjectSettings["budget"];
    llm: ProjectSettings["llm"];
    scenes: Array<{ id: string; narration: string; durationSec: number }>;
    signal: AbortSignal;
  }): Promise<{ scenes: Array<{ id: string; narration: string }>; shortenCalls: number }> {
    const routeProject = {
      id: input.profileId,
      mode: "AUTO" as const,
      settings: { language: input.language, llm: input.llm, budget: input.budget },
    };
    const route = deps.llm.resolveTask("translateScript", routeProject as never, getAppLlmSettings(deps.sqlite));
    const cache = new LlmCache(deps.sqlite, true);
    async function call(mode: "translate" | "shorten", scenes: typeof input.scenes) {
      const built = buildTranslateScriptPrompt({ language: input.language, mode, scenes });
      const generated = await generateRoutedStructured({
        registry: deps.llm,
        route,
        task: "translateScript",
        system: built.system,
        prompt: built.prompt,
        schema: TranslateScriptOutputSchema,
        schemaName: "TranslateScript",
        schemaVersion: "1",
        maxOutputTokens: route.maxOutputTokens ?? 4_096,
        signal: input.signal,
        cache,
      });
      return keepSceneIds(scenes, generated.value.scenes);
    }
    let translated = await call("translate", input.scenes);
    const long = input.scenes.filter((scene, index) => sceneNeedsShorten(
      scene.durationSec,
      translated[index]!.narration,
      input.language,
    ));
    let shortenCalls = 0;
    if (long.length > 0) {
      const shortened = await call("shorten", long);
      shortenCalls = 1;
      const byId = new Map(shortened.map((scene) => [scene.id, scene.narration]));
      translated = translated.map((scene) => ({
        id: scene.id,
        narration: byId.get(scene.id) ?? scene.narration,
      }));
    }
    return { scenes: translated, shortenCalls };
  }

  function saveScript(projectId: string, title: string, scenes: Array<{ id: string; label: string; narration: string; durationSec: number }>): void {
    const data = {
      title,
      hook: scenes[0]?.narration.slice(0, 180) ?? title,
      sections: scenes.map((scene) => ({
        id: scene.id,
        heading: scene.label || scene.id,
        narration: scene.narration,
        visualQueries: { primary: "", alternatives: [] },
        visualNotes: "",
        musicMood: "",
        energy: "medium",
        estDurationSec: scene.durationSec,
      })),
      outro: "",
      music: { mood: "", energy: "medium", keywords: [] },
    };
    const at = now().toISOString();
    deps.sqlite.prepare(
      `INSERT INTO scripts
        (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call, review_notes)
       VALUES (?, ?, 'AGENT', 0, ?, 1, 'mock', 'mock-v1', ?, 0, NULL)`,
    ).run(projectId, JSON.stringify(data), hash(JSON.stringify(data)), at);
  }

  function insertChildScenes(childId: string, parentScenesRows: SceneRow[], translated: Map<string, string>): Array<{ id: string; parentId: string; order: number; label: string; narration: string }> {
    const at = now().toISOString();
    const insert = deps.sqlite.prepare(
      `INSERT INTO scenes (
        id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_description,
        no_visual, visual_queries, music_mood, energy, est_duration_sec, start_sec, transition_note,
        origin, edited, input_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AGENT', 0, ?, ?, ?)`,
    );
    const created: Array<{ id: string; parentId: string; order: number; label: string; narration: string }> = [];
    for (const scene of parentScenesRows) {
      const id = randomUUID();
      const narration = translated.get(scene.id) ?? scene.narration;
      insert.run(
        id,
        childId,
        scene.order,
        scene.kind,
        scene.id,
        scene.label,
        narration,
        scene.visual_notes,
        scene.visual_description,
        scene.no_visual,
        scene.visual_queries,
        scene.music_mood,
        scene.energy,
        scene.est_duration_sec,
        scene.start_sec,
        scene.transition_note,
        hash(narration),
        at,
        at,
      );
      created.push({ id, parentId: scene.id, order: scene.order, label: scene.label, narration });
    }
    return created;
  }

  async function produce(input: {
    parentId: string;
    childId: string;
    language: string;
    mode: "dub" | "subtitles_only";
    voice?: string;
    accountIds: string[];
    signal: AbortSignal;
  }): Promise<void> {
    const parent = requireParent(input.parentId, false);
    const settings = ProjectSettingsSchema.parse(JSON.parse(parent.settings) as unknown);
    const scenes = deps.sqlite.prepare(
      "SELECT id, section_id, \"order\", label, narration, no_visual, est_duration_sec FROM scenes WHERE project_id = ? ORDER BY \"order\"",
    ).all(input.childId) as Array<{
      id: string;
      section_id: string;
      order: number;
      label: string;
      narration: string;
      no_visual: number;
      est_duration_sec: number;
    }>;
    const parentVoices = new Map((deps.sqlite.prepare(
      "SELECT scene_id, audio_path, duration_sec FROM voice_tracks WHERE project_id = ?",
    ).all(input.parentId) as VoiceRow[]).map((row) => [row.scene_id, row]));

    const provider = deps.tts.resolve();
    const voices = await provider.listVoices();
    const voiceName = input.voice || defaultVoiceFor(input.language, voices, deps.config, () => undefined);
    const rate = settings.voice?.rate || deps.config.TTS_RATE;
    const voiceDir = join(projectDir(deps.config.DATA_DIR, input.childId), "voice");
    mkdirSync(voiceDir, { recursive: true });
    const at = now().toISOString();
    const insertVoice = deps.sqlite.prepare(
      `INSERT INTO voice_tracks
        (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec, cues, input_hash, narration_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'AGENT', ?, ?, ?, ?, ?, ?, ?)`,
    );

    const voiceByChild = new Map<string, { path: string; durationSec: number }>();
    for (const scene of scenes) {
      const parentVoice = parentVoices.get(scene.section_id) ?? null;
      const original = parentVoice
        ? { path: parentVoice.audio_path, durationSec: parentVoice.duration_sec }
        : null;
      let synthesized: { path: string; durationSec: number } | null = null;
      if (input.mode === "dub") {
        const outPath = join(voiceDir, `${scene.id}.wav`);
        const spoken = await provider.synthesize({
          text: scene.narration,
          voice: voiceName,
          rate,
          outPath,
          signal: input.signal,
        });
        synthesized = { path: outPath, durationSec: spoken.durationSec };
      }
      const chosen = chooseVoice({ mode: input.mode, original, synthesized });
      insertVoice.run(
        randomUUID(),
        input.childId,
        scene.id,
        input.mode === "subtitles_only" ? "original" : provider.id,
        voiceName,
        rate,
        chosen.path,
        chosen.durationSec,
        "[]",
        hash(`${scene.narration}\0${chosen.path}`),
        hash(scene.narration),
        at,
        at,
      );
      voiceByChild.set(scene.id, chosen);
    }

    const visualsByParent = new Map<string, Array<{ candidateId: string; path: string | null; ready: boolean }>>();
    const visualRows = deps.sqlite.prepare(
      `SELECT s.scene_id, s.status, c.id AS candidate_id, c.local_path
       FROM visual_selections s
       JOIN visual_candidates c ON c.id = s.candidate_id
       WHERE s.project_id = ?
       ORDER BY s.slot ASC`,
    ).all(input.parentId) as Array<{ scene_id: string; status: string; candidate_id: string; local_path: string | null }>;
    for (const row of visualRows) {
      const list = visualsByParent.get(row.scene_id) ?? [];
      list.push({
        candidateId: row.candidate_id,
        path: row.local_path,
        ready: row.status === "APPROVED" && Boolean(row.local_path),
      });
      visualsByParent.set(row.scene_id, list);
    }

    const musicRow = deps.sqlite.prepare(
      `SELECT c.id, c.title, c.local_path, c.duration_sec, s.volume, s.fade_in_sec, s.fade_out_sec, s.ducking_db, s.start_offset_sec
       FROM music_selections s
       JOIN music_candidates c ON c.id = s.candidate_id
       WHERE s.project_id = ? AND s.status = 'APPROVED' AND c.local_path IS NOT NULL`,
    ).get(input.parentId) as {
      id: string;
      title: string;
      local_path: string;
      duration_sec: number | null;
      volume: number;
      fade_in_sec: number;
      fade_out_sec: number;
      ducking_db: number;
      start_offset_sec: number;
    } | undefined;

    const built = buildTimeline({
      aspectRatio: settings.aspectRatio,
      musicEnabled: settings.music.enabled,
      music: musicRow ? {
        candidateId: musicRow.id,
        title: musicRow.title,
        path: musicRow.local_path,
        sourceDurationSec: musicRow.duration_sec,
        startOffsetSec: musicRow.start_offset_sec,
        volume: musicRow.volume,
        fadeInSec: musicRow.fade_in_sec,
        fadeOutSec: musicRow.fade_out_sec,
        duckingDb: musicRow.ducking_db,
        licenseKind: null,
      } : null,
      scenes: scenes.map((scene) => {
        const voice = voiceByChild.get(scene.id)!;
        const visuals = (visualsByParent.get(scene.section_id) ?? []).map((visual) => ({
          candidateId: visual.candidateId,
          path: visual.path,
          ready: visual.ready,
          licenseKind: null,
          motion: null,
        }));
        return {
          id: scene.id,
          order: scene.order,
          label: scene.label,
          noVisual: scene.no_visual === 1 || visuals.length === 0,
          durationOverrideSec: null,
          estDurationSec: scene.est_duration_sec,
          voice: { trackId: scene.id, path: voice.path, durationSec: voice.durationSec },
          visuals,
        };
      }),
    });
    const { voiceOffsets, ...timelineBody } = built;

    const subtitleDir = join(projectDir(deps.config.DATA_DIR, input.childId), "subtitles");
    mkdirSync(subtitleDir, { recursive: true });
    const cues = scenes.flatMap((scene) => {
      const voice = voiceByChild.get(scene.id)!;
      const offset = voiceOffsets[scene.id] ?? 0;
      return cuesWithoutTimings(scene.narration, voice.durationSec, {
        maxCharsPerLine: settings.subtitles.maxCharsPerLine,
        aspectRatio: settings.aspectRatio,
      }).map((cue) => ({
        ...cue,
        startSec: cue.startSec + offset,
        endSec: cue.endSec + offset,
      }));
    });
    const srtPath = join(subtitleDir, "subtitles.srt");
    const assPath = join(subtitleDir, "subtitles.ass");
    writeFileSync(srtPath, toSrt(cues));
    writeFileSync(assPath, toAss(cues));
    deps.sqlite.prepare(
      `INSERT INTO subtitle_tracks (id, project_id, cues, srt_path, ass_path, input_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), input.childId, JSON.stringify(cues), srtPath, assPath, hash(JSON.stringify(cues)), at, at);

    const timeline = {
      ...timelineBody,
      subtitles: { srtPath, assPath, cueCount: cues.length },
    };
    deps.sqlite.prepare(
      `INSERT INTO timelines (project_id, data, input_hash, total_duration_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(input.childId, JSON.stringify(timeline), hash(JSON.stringify(timeline)), timeline.totalDurationSec, at, at);

    const features = resolveBudget(settings.budget ?? { mode: "BALANCED" });
    let draft = trimMetadata({
      titles: [`${parent.title} (${input.language})`],
      description: parent.description || parent.topic,
      tags: [],
      hashtags: [],
      thumbnailText: [],
    });
    if (features.metadata || features.translateScript) {
      const routeProject = {
        id: input.childId,
        mode: "AUTO" as const,
        settings: { language: input.language, llm: settings.llm, budget: settings.budget },
      };
      const route = deps.llm.resolveTask("metadata", routeProject as never, getAppLlmSettings(deps.sqlite));
      const generated = await generateRoutedStructured({
        registry: deps.llm,
        route,
        task: "metadata",
        system: "Adapt the publishing metadata into the target language. Keep facts. Stay inside platform limits. Reply with JSON only.",
        prompt: JSON.stringify({
          language: input.language,
          title: parent.title,
          description: parent.description,
          narration: scenes.map((scene) => scene.narration).join("\n"),
        }),
        schema: TranslateMetadataRawSchema,
        schemaName: "TranslateMetadata",
        schemaVersion: "1",
        maxOutputTokens: route.maxOutputTokens ?? 2_048,
        signal: input.signal,
        cache: new LlmCache(deps.sqlite, true),
      });
      draft = trimMetadata(generated.value);
    }
    deps.sqlite.prepare(
      `INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'LLM', ?, ?)`,
    ).run(input.childId, hash(JSON.stringify(draft)), JSON.stringify(draft), at, at);

    const overlay = draft.thumbnailText[0];
    if (overlay) {
      deps.sqlite.prepare(
        "UPDATE projects SET thumbnail_path = ?, thumbnail_meta = ? WHERE id = ?",
      ).run(
        parent.thumbnail_path,
        JSON.stringify({ frameTimeSec: 1, text: overlay.slice(0, 32), position: "bottom", source: "auto" }),
        input.childId,
      );
    }

    await maybeYoutubeExtras({
      parentId: input.parentId,
      language: input.language,
      accountIds: input.accountIds,
      title: draft.titles[0] ?? parent.title,
      description: draft.description,
      srt: toSrt(cues),
    });

    for (const stage of STAGE_ORDER) {
      if (stage === "RENDER") setStage(input.childId, stage, "PENDING", "Sẵn sàng render bản dịch");
      else if (stage === "SCRIPT" || stage === "VOICE" || stage === "SUBTITLE" || stage === "TIMELINE") setStage(input.childId, stage, "DONE", null);
      else setStage(input.childId, stage, "SKIPPED", null);
    }
    deps.sqlite.prepare(
      "UPDATE projects SET status = 'GENERATING', stage = 'RENDER', updated_at = ?, duration_sec = ? WHERE id = ?",
    ).run(at, Math.round(timeline.totalDurationSec), input.childId);
  }

  async function maybeYoutubeExtras(input: {
    parentId: string;
    language: string;
    accountIds: string[];
    title: string;
    description: string;
    srt: string;
  }): Promise<void> {
    if (input.accountIds.length === 0) return;
    const publication = deps.sqlite.prepare(
      `SELECT external_id, account_id FROM publications
       WHERE project_id = ? AND external_id IS NOT NULL
       ORDER BY published_at DESC LIMIT 1`,
    ).get(input.parentId) as { external_id: string; account_id: string } | undefined;
    if (!publication || !input.accountIds.includes(publication.account_id)) return;
    const tokens = deps.vault.loadTokens(publication.account_id);
    const scopes = deps.vault.getCredentialMeta(publication.account_id)?.scopes ?? [];
    if (!tokens) return;
    await applyYoutubeLanguageExtras({
      scopes,
      accessToken: tokens.accessToken,
      videoId: publication.external_id,
      language: input.language,
      title: input.title,
      description: input.description,
      srt: input.srt,
      fetchImpl: (url, init) => fetch(url, init),
    });
  }

  async function start(projectId: string, language: string, signal: AbortSignal): Promise<{
    childId: string;
    waitingReview: boolean;
    shortenCalls: number;
  }> {
    const parent = requireParent(projectId, true);
    if (!parent.profile_id) throw new AppError(409, "PROFILE_REQUIRED", "Dự án chưa gắn hồ sơ.");
    const profile = await deps.profiles.getDetail(parent.profile_id);
    const target = (profile.translations ?? []).find((item) => item.language === language);
    if (!target) throw new AppError(404, "LANGUAGE_NOT_CONFIGURED", "Hồ sơ chưa cấu hình ngôn ngữ này.");
    const features = resolveBudget(profile.defaultBrief.budget ?? { mode: "BALANCED" });
    if (!features.translateScript) {
      throw new AppError(409, "TRANSLATE_OFF", "Chế độ ngân sách đang tắt dịch kịch bản.");
    }
    const existing = childRows(projectId).find((row) => {
      const settings = JSON.parse(row.settings) as ProjectSettings;
      return settings.language === language;
    });
    if (existing) {
      return { childId: existing.id, waitingReview: waiting(existing.id), shortenCalls: 0 };
    }
    const scenes = parentScenes(projectId);
    if (scenes.length === 0) throw new AppError(409, "SCENES_REQUIRED", "Video gốc chưa có cảnh.");
    const parentSettings = ProjectSettingsSchema.parse(JSON.parse(parent.settings) as unknown);
    const voices = deps.sqlite.prepare(
      "SELECT scene_id, duration_sec FROM voice_tracks WHERE project_id = ?",
    ).all(projectId) as Array<{ scene_id: string; duration_sec: number }>;
    const voiceDuration = new Map(voices.map((row) => [row.scene_id, row.duration_sec]));
    const payload = scenes.map((scene) => ({
      id: scene.id,
      narration: scene.narration,
      durationSec: voiceDuration.get(scene.id) ?? scene.est_duration_sec,
    }));
    const translated = await translateScenes({
      profileId: parent.profile_id,
      language,
      budget: parentSettings.budget,
      llm: parentSettings.llm,
      scenes: payload,
      signal,
    });
    const childId = randomUUID();
    const at = now().toISOString();
    const automationOn = profile.automation.enabled;
    const settings = ProjectSettingsSchema.parse({
      ...parentSettings,
      language,
      voice: target.voice ? { ...(parentSettings.voice ?? {}), voice: target.voice } : parentSettings.voice,
      translation: { mode: target.mode, parentLanguage: parentSettings.language },
    });
    deps.sqlite.prepare(
      `INSERT INTO projects (
        id, title, description, topic, mode, settings, status, stage, version, profile_id,
        created_at, updated_at, kind, parent_project_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'GENERATING', 'SCRIPT', 1, ?, ?, ?, 'translation', ?)`,
    ).run(
      childId,
      `${parent.title} (${language})`.slice(0, 200),
      parent.description,
      parent.topic,
      automationOn ? "AUTO" : "ASSISTED",
      JSON.stringify(settings),
      parent.profile_id,
      at,
      at,
      projectId,
    );
      inheritWorkspace(deps.sqlite, "projects", childId, "projects", projectId);
    createProjectDir(deps.config.DATA_DIR, childId);
    seedStages(childId);
    const byId = new Map(translated.scenes.map((scene) => [scene.id, scene.narration]));
    const created = insertChildScenes(childId, scenes, byId);
    saveScript(childId, `${parent.title} (${language})`, created.map((scene) => ({
      id: scene.parentId,
      label: scene.label,
      narration: scene.narration,
      durationSec: payload.find((item) => item.id === scene.parentId)?.durationSec ?? 0,
    })));
    const review = translationNeedsReview(automationOn);
    if (review) {
      setStage(childId, "SCRIPT", "WAITING_USER", TRANSLATION_REVIEW_MESSAGE);
      deps.sqlite.prepare(
        "UPDATE projects SET status = 'REVIEW', stage = 'SCRIPT', updated_at = ? WHERE id = ?",
      ).run(at, childId);
      return { childId, waitingReview: true, shortenCalls: translated.shortenCalls };
    }
    setStage(childId, "SCRIPT", "DONE", null);
    await produce({
      parentId: projectId,
      childId,
      language,
      mode: target.mode,
      voice: target.voice,
      accountIds: target.accountIds,
      signal,
    });
    return { childId, waitingReview: false, shortenCalls: translated.shortenCalls };
  }

  async function approve(childId: string, signal: AbortSignal): Promise<{ childId: string }> {
    const child = deps.sqlite.prepare(
      "SELECT id, parent_project_id, settings, profile_id FROM projects WHERE id = ? AND kind = 'translation'",
    ).get(childId) as { id: string; parent_project_id: string | null; settings: string; profile_id: string | null } | undefined;
    if (!child?.parent_project_id) throw new AppError(404, "TRANSLATION_NOT_FOUND", "Không tìm thấy bản dịch.");
    if (!waiting(childId)) throw new AppError(409, "NOT_WAITING", "Bản dịch không đang chờ duyệt.");
    const settings = ProjectSettingsSchema.parse(JSON.parse(child.settings) as unknown);
    const targets = targetsFor(child.profile_id);
    const target = targets.find((item) => item.language === settings.language);
    setStage(childId, "SCRIPT", "DONE", null);
    await produce({
      parentId: child.parent_project_id,
      childId,
      language: settings.language,
      mode: settings.translation?.mode ?? target?.mode ?? "dub",
      voice: target?.voice ?? settings.voice?.voice,
      accountIds: target?.accountIds ?? [],
      signal,
    });
    return { childId };
  }

  return { view, start, approve };
}

export type TranslationService = ReturnType<typeof createTranslationService>;
