import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  FONT_REGISTRY,
  STYLE_PRESETS,
  parseHex,
  resolveStyle,
  reviseStylePack,
  stylePackFingerprint,
  stylePackFromBrand,
  stylePackFromChoices,
  stylePackFromProposal,
  stylePackTokens,
  styleSimilarity,
  type ContrastIssue,
  type FontIssue,
  type PaletteRoles,
  type StylePack,
  type StyleTokens,
  type StyleTokensPatch,
  type VideoLook,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { LlmCache } from "../providers/llm/cache.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { PROFILE_SWATCH, StyleService } from "./service.js";

/** Two channels at or above this look alike (palette 0.5, fonts, layout, background, motion). */
export const SIMILAR_CHANNEL_MIN = 0.8;

export type StyleSummary = {
  fingerprint: string;
  color: PaletteRoles;
  fonts: { display: string; body: string };
  issues: { contrast: ContrastIssue[]; fonts: FontIssue[] };
  /**
   * Colours the resolver moved so text stays readable (it repairs the palette, so a real
   * contrast issue is rare). Vietnamese sentences for the editor.
   */
  adjusted: string[];
};

export type SimilarChannel = { profileId: string; name: string; score: number };

export type StyleSaveResult = {
  pack: StylePack;
  tokens: StyleTokens;
  changed: boolean;
  style: StyleSummary;
  similar: SimilarChannel[];
};

export type StyleDraft = {
  pack: StylePack;
  tokens: StyleTokens;
  /** Token groups the proposal had but the validator removed. */
  dropped: string[];
  source: "llm" | "preset";
  /** Vietnamese sentence for the user: why this draft, or why no LLM was used. */
  message: string;
  style: StyleSummary;
  similar: SimilarChannel[];
};

export type StyleDesignerDeps = {
  sqlite: Database.Database;
  registry?: LlmProviderRegistry;
  config?: AppConfig;
  /** Test hook: replaces the contrast check, because the palette resolver repairs real palettes. */
  contrastOf?: (pack: StylePack) => ContrastIssue[];
  /** Test hook: stands in for the model. Receives the prompt and returns the raw proposal. */
  generate?: (built: { system: string; prompt: string }) => Promise<unknown>;
};

/** The bare fields of a look that `styleSimilarity` compares. */
function lookStyle(pack: StylePack): VideoLook["style"] {
  const resolved = resolveStyle({ pack }, { width: 1920, height: 1080 });
  return {
    packId: pack.id,
    packVersion: pack.version,
    fingerprint: resolved.fingerprint,
    palette: [resolved.color.bg, resolved.color.accent, resolved.color.text],
    fonts: [resolved.font.display.id, resolved.font.body.id],
    layout: resolved.layout.family,
    ease: resolved.tokens.motion.ease,
    caseDisplay: resolved.type.caseDisplay,
    backgrounds: [...resolved.background.treatments].sort(),
  };
}

export function summarizeStyle(pack: StylePack): StyleSummary {
  const resolved = resolveStyle({ pack }, { width: 1920, height: 1080 });
  return {
    fingerprint: resolved.fingerprint,
    color: resolved.color,
    fonts: { display: resolved.font.display.id, body: resolved.font.body.id },
    issues: resolved.issues,
    adjusted: adjustments(pack, resolved.color),
  };
}

function adjustments(pack: StylePack, color: PaletteRoles): string[] {
  const seed = stylePackTokens(pack).palette;
  const out: string[] = [];
  if (seed.brand.toUpperCase() !== color.bg.toUpperCase()) {
    out.push(`Màu nền ${seed.brand.toUpperCase()} được chỉnh thành ${color.bg.toUpperCase()} để chữ dễ đọc.`);
  }
  if (seed.accent.toUpperCase() !== color.accent.toUpperCase()) {
    out.push(`Màu nhấn ${seed.accent.toUpperCase()} được chỉnh thành ${color.accent.toUpperCase()} để đủ tương phản với nền.`);
  }
  return out;
}

/** The user-facing refusal for a pack whose colours cannot be read. */
export function contrastRefusal(issues: ContrastIssue[]): string {
  const worst = issues.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a));
  return `Màu chữ khó đọc (cặp ${worst.pair}: ${worst.ratio.toFixed(1)}:1, cần ít nhất ${worst.min}:1). Đổi màu chữ hoặc màu nền rồi lưu lại.`;
}

export class StyleDesigner {
  readonly styles: StyleService;

  constructor(private readonly deps: StyleDesignerDeps) {
    this.styles = new StyleService(deps.sqlite);
  }

  private require(profileId: string) {
    const facts = this.styles.profileFacts(profileId);
    if (!facts) throw new AppError(404, "NOT_FOUND", "Không tìm thấy hồ sơ.");
    return facts;
  }

  similarChannels(profileId: string, pack: StylePack): SimilarChannel[] {
    const mine = lookStyle(pack);
    return this.styles.otherChannelPacks(profileId)
      .map((other) => ({ profileId: other.profileId, name: other.name, score: Math.round(styleSimilarity(mine, lookStyle(other.pack)) * 100) / 100 }))
      .filter((row) => row.score >= SIMILAR_CHANNEL_MIN)
      .sort((a, b) => b.score - a.score);
  }

  /** Refuses (400) a look with a blocking contrast issue; returns the summary otherwise. */
  private check(pack: Pick<StylePack, "id" | "version" | "tokens" | "seed">): StyleSummary {
    const summary = summarizeStyle(pack as StylePack);
    const blocking = this.deps.contrastOf ? this.deps.contrastOf(pack as StylePack) : summary.issues.contrast;
    if (blocking.length > 0) throw new AppError(400, "STYLE_CONTRAST", contrastRefusal(blocking));
    return summary;
  }

  private result(profileId: string, saved: { pack: StylePack; changed: boolean }): StyleSaveResult {
    return {
      pack: saved.pack,
      tokens: stylePackTokens(saved.pack),
      changed: saved.changed,
      style: summarizeStyle(saved.pack),
      similar: this.similarChannels(profileId, saved.pack),
    };
  }

  private save(profileId: string, draft: Pick<StylePack, "tokens" | "origin">): StyleSaveResult {
    const current = this.styles.packForProfile(profileId)!;
    this.check({ id: current.id, version: current.version, tokens: draft.tokens, seed: current.seed });
    const saved = this.styles.commit(profileId, draft);
    if (!saved) throw new AppError(404, "NOT_FOUND", "Không tìm thấy hồ sơ.");
    return this.result(profileId, saved);
  }

  fromPreset(profileId: string, presetId: string): StyleSaveResult {
    const facts = this.require(profileId);
    const preset = STYLE_PRESETS.find((item) => item.id === presetId);
    if (!preset) throw new AppError(400, "STYLE_PRESET_UNKNOWN", "Không có mẫu phong cách này.");
    const pack = stylePackFromChoices({ id: profileId, name: facts.name.slice(0, 60) || "Kênh", presetId });
    return this.save(profileId, { tokens: pack.tokens, origin: { kind: "preset", presetId } });
  }

  fromChoices(profileId: string, choices: {
    presetId?: string; brand?: string; accent?: string; mode?: "dark" | "light";
    energy?: "calm" | "balanced" | "lively"; layout?: StyleTokens["layout"]["family"];
  }): StyleSaveResult {
    const facts = this.require(profileId);
    const pack = stylePackFromChoices({ id: profileId, name: facts.name.slice(0, 60) || "Kênh", ...choices });
    return this.save(profileId, { tokens: pack.tokens, origin: pack.origin });
  }

  fromBrand(profileId: string, input: { colors: string[]; presetId?: string }): StyleSaveResult {
    const facts = this.require(profileId);
    if (!input.colors.some((color) => parseHex(color))) {
      throw new AppError(400, "STYLE_BRAND_COLORS", "Cần ít nhất một màu hợp lệ, ví dụ #1D4ED8.");
    }
    const pack = stylePackFromBrand({ id: profileId, name: facts.name.slice(0, 60) || "Kênh", colors: input.colors, ...(input.presetId ? { presetId: input.presetId } : {}) });
    return this.save(profileId, { tokens: pack.tokens, origin: pack.origin });
  }

  /** Manual token edit. A reason is kept in the origin note. */
  patch(profileId: string, patch: StyleTokensPatch, reason: string): StyleSaveResult {
    this.require(profileId);
    const latest = this.styles.packForProfile(profileId)!;
    const merged = reviseStylePack(latest, patch, { kind: "manual" }).tokens;
    this.check({ id: latest.id, version: latest.version, tokens: merged, seed: latest.seed });
    const saved = this.styles.commitPatch(profileId, patch, reason);
    if (!saved) throw new AppError(404, "NOT_FOUND", "Không tìm thấy hồ sơ.");
    return this.result(profileId, saved);
  }

  revert(profileId: string, version: number): StyleSaveResult {
    this.require(profileId);
    const latest = this.styles.packForProfile(profileId)!;
    const old = this.styles.getPack(latest.id, version);
    if (!old) throw new AppError(404, "NOT_FOUND", `Không có bản ${version} của phong cách này.`);
    return this.save(profileId, { tokens: old.tokens, origin: { kind: "manual", note: `Hoàn về bản ${version}` } });
  }

  /**
   * A draft, never saved. ECO makes no model call: it returns the preset nearest to the
   * channel's colour that no other channel uses.
   */
  async propose(profileId: string, note: string | undefined, signal?: AbortSignal): Promise<StyleDraft> {
    const facts = this.require(profileId);
    const current = this.styles.packForProfile(profileId)!;
    const others = this.styles.otherChannelPacks(profileId);
    const name = facts.name.slice(0, 60) || "Kênh";

    if (facts.budgetMode === "ECO" || (!this.deps.generate && !this.deps.registry)) {
      const { preset, allUsed } = this.styles.nearestUnusedPreset(profileId, stylePackTokens(current));
      const pack = stylePackFromChoices({ id: profileId, name, presetId: preset.id });
      const draftPack: StylePack = { ...pack, version: current.version + 1, seed: current.seed ?? profileId, origin: { kind: "preset", presetId: preset.id } };
      return {
        pack: draftPack,
        tokens: stylePackTokens(draftPack),
        dropped: [],
        source: "preset",
        message: facts.budgetMode === "ECO"
          ? `Chế độ ECO không gọi AI. Đây là mẫu "${preset.nameVi}"${allUsed ? " (kênh nào cũng đã dùng một mẫu, mẫu này ít trùng nhất)" : ", chưa kênh nào khác dùng"}.`
          : `Chưa có model AI để gợi ý. Đây là mẫu "${preset.nameVi}"${allUsed ? "" : ", chưa kênh nào khác dùng"}.`,
        style: summarizeStyle(draftPack),
        similar: this.similarChannels(profileId, draftPack),
      };
    }

    const swatch = parseHex(PROFILE_SWATCH);
    const brand = parseHex(facts.color);
    const brandColors = brand && swatch && facts.color.toUpperCase() !== PROFILE_SWATCH ? [facts.color.toUpperCase()] : [];
    const built = buildStylePackPrompt({
      niche: facts.direction,
      market: facts.market,
      language: facts.language,
      brandColors,
      others: others.map((other) => describePack(other.name, other.pack)),
      note: note?.trim() ?? "",
    });
    const raw = this.deps.generate
      ? await this.deps.generate(built)
      : await this.callModel(profileId, facts, built, signal);
    const { pack, dropped } = stylePackFromProposal(raw, { id: profileId, name, ...(note?.trim() ? { note: note.trim() } : {}) });
    const draftPack: StylePack = { ...pack, version: current.version + 1, seed: current.seed ?? profileId };
    return {
      pack: draftPack,
      tokens: stylePackTokens(draftPack),
      dropped,
      source: "llm",
      message: dropped.length > 0
        ? `AI đề xuất một phong cách. Đã bỏ phần không hợp lệ: ${dropped.join(", ")}.`
        : "AI đề xuất một phong cách khác các kênh còn lại. Xem thử rồi mới lưu.",
      style: summarizeStyle(draftPack),
      similar: this.similarChannels(profileId, draftPack),
    };
  }

  private async callModel(
    profileId: string,
    facts: NonNullable<ReturnType<StyleService["profileFacts"]>>,
    built: { system: string; prompt: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { registry, sqlite, config } = this.deps;
    if (!registry) throw new AppError(503, "LLM_UNAVAILABLE", "Chưa có model AI.");
    const routeProject = {
      id: profileId, profileId, topic: facts.direction, description: facts.direction,
      mode: "AUTO" as const,
      settings: { language: facts.language, budget: { mode: facts.budgetMode } },
    };
    const route = registry.resolveTask("stylePack", routeProject as never, getAppLlmSettings(sqlite));
    const generated = await generateRoutedStructured({
      registry,
      route,
      task: "stylePack",
      system: built.system,
      prompt: built.prompt,
      schema: z.record(z.string(), z.unknown()),
      schemaName: "StylePackProposal",
      schemaVersion: "1",
      maxOutputTokens: route.maxOutputTokens ?? 1_536,
      signal: signal ?? new AbortController().signal,
      cache: new LlmCache(sqlite, true),
      cacheKeyExtra: createHash("sha256").update(built.prompt).digest("hex"),
    });
    this.recordUsage(generated, config);
    return generated.value;
  }

  /** Cost of the call goes to usage as one job row, like the review chat does. */
  private recordUsage(
    generated: Awaited<ReturnType<typeof generateRoutedStructured<Record<string, unknown>>>>,
    config: AppConfig | undefined,
  ): void {
    if (generated.cached) return;
    const base = {
      llmCalls: generated.usage.llmCalls,
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      provider: generated.provider,
      model: generated.model,
      ...(generated.usage.tokensUnknown ? { tokensUnknown: true } : {}),
      features: { stylePack: generated.usage.llmCalls },
      calls: generated.usage.calls,
    };
    const costUsd = config ? estimateLlmCost(config, generated.provider, generated.model, base) : 0;
    const now = new Date().toISOString();
    this.deps.sqlite.prepare(
      `INSERT INTO jobs (
         id, project_id, stage, scope, status, progress, message, attempt, max_attempts,
         error, usage, created_at, started_at, finished_at, run_after, previous_state
       ) VALUES (?, NULL, 'ASSISTANT', 'stylePack', 'SUCCEEDED', 100, 'Gợi ý phong cách', 1, 1,
         NULL, ?, ?, ?, ?, ?, 'PENDING')`,
    ).run(randomUUID(), JSON.stringify({ ...base, costUsd }), now, now, now, now);
  }
}

function describePack(name: string, pack: StylePack): Record<string, unknown> {
  const tokens = stylePackTokens(pack);
  return {
    channel: name,
    fingerprint: stylePackFingerprint(pack),
    mode: tokens.palette.mode,
    brand: tokens.palette.brand,
    accent: tokens.palette.accent,
    fonts: [tokens.type.display.family, tokens.type.body.family],
    layout: tokens.layout.family,
    ease: tokens.motion.ease,
  };
}

export function buildStylePackPrompt(input: {
  niche: string;
  market: string | null;
  language: string;
  brandColors: string[];
  others: Record<string, unknown>[];
  note: string;
}): { system: string; prompt: string } {
  const example = STYLE_PRESETS.find((preset) => preset.id === "newsroom")?.tokens ?? {};
  return {
    system: [
      "You design the look of one video channel as a JSON patch of design tokens (tokens-v1).",
      "Allowed top-level groups: palette, type, motion, rhythm, layout, background.",
      "palette = {mode: dark|light, brand: #RRGGBB, accent: #RRGGBB, accent2?: #RRGGBB}.",
      "type = {display: {family, weight}, body: {family, weight}, caseDisplay: none|upper}.",
      `Font families must be one of: ${Object.keys(FONT_REGISTRY).join(", ")}.`,
      "The channel must look clearly different from every channel in `others`: change the colours, the fonts and the layout, not only one of them.",
      "Respect the brandColors when there are any. Keep text readable: strong contrast between ground and ink.",
      `Example of the shape (do not copy it): ${JSON.stringify(example)}`,
      "Reply with the JSON object only.",
    ].join(" "),
    prompt: JSON.stringify({
      niche: input.niche,
      market: input.market,
      language: input.language,
      brandColors: input.brandColors,
      others: input.others,
      note: input.note,
    }),
  };
}
