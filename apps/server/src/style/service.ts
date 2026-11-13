import { randomUUID } from "node:crypto";
import { inheritWorkspace, stampWorkspace } from "../auth/requestContext.js";
import type Database from "better-sqlite3";
import {
  buildVideoLook,
  colorDistance,
  parseHex,
  reviseStylePack,
  stylePackFingerprint,
  STYLE_PRESETS,
  StylePackSchema,
  stylePackFromBrand,
  stylePackTokens,
  toHex,
  VideoLookSchema,
  type LookHistory,
  type ResolvedStyle,
  type StylePack,
  type StylePreset,
  type StyleTokens,
  type StyleTokensPatch,
  type VariantPick,
  type VideoLook,
} from "@vg/shared";

/** The swatch every new profile gets. It is not a chosen brand colour. */
export const PROFILE_SWATCH = "#3B82F6";

type PackRow = {
  id: string;
  version: number;
  name: string;
  origin: string;
  seed: string | null;
  tokens: string;
  created_at: string;
};

type ProfilePackRow = {
  id: string;
  name: string;
  color: string;
  style_pack_id: string | null;
};

export type RecordLookInput = {
  id?: string;
  projectId: string;
  renderId: string;
  profileId: string | null;
  createdAt?: string;
  style: ResolvedStyle;
  picks: VariantPick[];
  shotSec: Record<string, number>;
  kindShare: Record<string, number>;
  frameHashes: string[];
};

function asJson<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

/**
 * Stored style packs and the looks of finished videos (TASK-109).
 * Packs are insert-only. A profile with no pack gets one the first time it renders.
 */
export class StyleService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Latest version when `version` is omitted. */
  getPack(id: string, version?: number): StylePack | null {
    const row = version === undefined
      ? this.sqlite.prepare("SELECT * FROM style_packs WHERE id = ? ORDER BY version DESC LIMIT 1").get(id)
      : this.sqlite.prepare("SELECT * FROM style_packs WHERE id = ? AND version = ?").get(id, version);
    return row ? this.toPack(row as PackRow) : null;
  }

  /** Inserts a new version through `reviseStylePack`. Does nothing when the look is unchanged. */
  savePack(pack: StylePack): StylePack {
    const parsed = StylePackSchema.parse(pack);
    const save = this.sqlite.transaction(() => {
      const latest = this.getPack(parsed.id);
      if (!latest) {
        this.insertPack(parsed);
        return parsed;
      }
      const revised = reviseStylePack(latest, parsed.tokens, parsed.origin);
      if (revised.version === latest.version) return latest;
      const stored = StylePackSchema.parse({ ...revised, name: parsed.name, seed: latest.seed ?? revised.seed });
      this.insertPack(stored);
      return stored;
    });
    return save.immediate();
  }

  /** Latest version of each pack. */
  listPacks(): StylePack[] {
    const rows = this.sqlite.prepare(`
      SELECT sp.* FROM style_packs sp
      INNER JOIN (
        SELECT id, MAX(version) AS version FROM style_packs GROUP BY id
      ) latest ON latest.id = sp.id AND latest.version = sp.version
      ORDER BY sp.name COLLATE NOCASE, sp.id
    `).all() as PackRow[];
    return rows.map((row) => this.toPack(row));
  }

  /**
   * The profile's pack. The first call for a profile with none creates and links one:
   * from its brand colour when that colour is not the default swatch, otherwise from a
   * preset the other profiles are not already using.
   */
  packForProfile(profileId: string): StylePack | null {
    const load = this.sqlite.transaction(() => {
      const profile = this.sqlite.prepare(
        "SELECT id, name, color, style_pack_id FROM profiles WHERE id = ?",
      ).get(profileId) as ProfilePackRow | undefined;
      if (!profile) return null;
      if (profile.style_pack_id) {
        const existing = this.getPack(profile.style_pack_id);
        if (existing) return existing;
      }
      const pack = this.initialPack(profile);
      this.insertPack(pack);
      this.sqlite.prepare("UPDATE profiles SET style_pack_id = ?, updated_at = ? WHERE id = ?").run(
        pack.id,
        this.now().toISOString(),
        profile.id,
      );
      return pack;
    });
    return load.immediate();
  }

  /** The linked pack, without creating one. `null` when the profile or the pack is missing. */
  linkedPack(profileId: string): { found: true; pack: StylePack | null; tokens: StyleTokens | null } | { found: false } {
    const row = this.sqlite.prepare(
      "SELECT style_pack_id FROM profiles WHERE id = ?",
    ).get(profileId) as { style_pack_id: string | null } | undefined;
    if (!row) return { found: false };
    const pack = row.style_pack_id ? this.getPack(row.style_pack_id) : null;
    return { found: true, pack, tokens: pack ? stylePackTokens(pack) : null };
  }

  /** Profile facts the style pages need. `null` when the profile does not exist. */
  profileFacts(profileId: string): { id: string; name: string; color: string; language: string; market: string | null; direction: string; budgetMode: string; aspect: "16:9" | "9:16" | "1:1" } | null {
    const row = this.sqlite.prepare(
      "SELECT id, name, color, language, market, direction, default_brief FROM profiles WHERE id = ?",
    ).get(profileId) as { id: string; name: string; color: string; language: string; market: string | null; direction: string; default_brief: string } | undefined;
    if (!row) return null;
    const brief = asJson<{ budget?: { mode?: string }; aspectRatio?: string }>(row.default_brief ?? "{}");
    const aspect = brief.aspectRatio === "9:16" || brief.aspectRatio === "1:1" ? brief.aspectRatio : "16:9";
    return { id: row.id, name: row.name, color: row.color, language: row.language, market: row.market, direction: row.direction, budgetMode: brief.budget?.mode ?? "BALANCED", aspect };
  }

  /** Every version of the profile's pack, newest first. */
  versions(profileId: string): StylePack[] | null {
    const pack = this.packForProfile(profileId);
    if (!pack) return null;
    const rows = this.sqlite.prepare("SELECT * FROM style_packs WHERE id = ? ORDER BY version DESC").all(pack.id) as PackRow[];
    return rows.map((row) => this.toPack(row));
  }

  /** Latest pack of every other channel, so a new look can differ from them. */
  otherChannelPacks(profileId: string): { profileId: string; name: string; pack: StylePack }[] {
    const rows = this.sqlite.prepare(
      "SELECT id, name, style_pack_id FROM profiles WHERE id != ? AND style_pack_id IS NOT NULL AND archived_at IS NULL ORDER BY name COLLATE NOCASE",
    ).all(profileId) as { id: string; name: string; style_pack_id: string }[];
    const result: { profileId: string; name: string; pack: StylePack }[] = [];
    for (const row of rows) {
      const pack = this.getPack(row.style_pack_id);
      if (pack) result.push({ profileId: row.id, name: row.name, pack });
    }
    return result;
  }

  /**
   * Saves `draft`'s look as the next version of the profile's pack. The pack id, name and seed
   * stay; the tokens are replaced as a whole (a patch merge is `reviseStylePack`'s job).
   * Rows are never deleted. `changed` is false when the look is the same as the latest version.
   */
  commit(profileId: string, draft: Pick<StylePack, "tokens" | "origin">): { pack: StylePack; changed: boolean } | null {
    const run = this.sqlite.transaction(() => {
      const latest = this.packForProfile(profileId);
      if (!latest) return null;
      const sameLook = stylePackFingerprint(latest) === stylePackFingerprint(draft);
      if (sameLook && JSON.stringify(latest.origin) === JSON.stringify(draft.origin)) return { pack: latest, changed: false };
      const stored = StylePackSchema.parse({
        ...latest,
        version: latest.version + 1,
        origin: draft.origin,
        tokens: draft.tokens,
      });
      this.insertPack(stored);
      this.sqlite.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(this.now().toISOString(), profileId);
      return { pack: stored, changed: true };
    });
    return run.immediate();
  }

  /** A manual token edit: merged over the latest version through `reviseStylePack`. */
  commitPatch(profileId: string, patch: StyleTokensPatch, note?: string): { pack: StylePack; changed: boolean } | null {
    const latest = this.packForProfile(profileId);
    if (!latest) return null;
    const revised = reviseStylePack(latest, patch, { kind: "manual", ...(note ? { note: note.slice(0, 200) } : {}) });
    return this.commit(profileId, revised);
  }

  /** The old tokens saved as a new version. */
  revert(profileId: string, version: number): { pack: StylePack; changed: boolean } | null | "missing_version" {
    const latest = this.packForProfile(profileId);
    if (!latest) return null;
    const old = this.getPack(latest.id, version);
    if (!old) return "missing_version";
    return this.commit(profileId, { tokens: old.tokens, origin: { kind: "manual", note: `Hoàn về bản ${version}` } });
  }

  /** The preset no other channel uses that looks most like the current palette; null-safe on an empty list. */
  nearestUnusedPreset(profileId: string, near?: StyleTokens | null): { preset: StylePreset; allUsed: boolean } {
    const used = new Set<string>();
    for (const other of this.otherChannelPacks(profileId)) {
      if (other.pack.origin.kind === "preset" && other.pack.origin.presetId) used.add(other.pack.origin.presetId);
    }
    const free = STYLE_PRESETS.filter((preset) => !used.has(preset.id));
    const pool = free.length > 0 ? free : STYLE_PRESETS;
    const target = near?.palette.brand ?? null;
    const score = (preset: StylePreset) => {
      const brand = preset.tokens.palette?.brand;
      return target && brand ? colorDistance(target, brand) : 0;
    };
    const best = pool.reduce((a, b) => (score(b) < score(a) ? b : a));
    return { preset: best, allUsed: free.length === 0 };
  }

  presets(): StylePreset[] {
    return STYLE_PRESETS;
  }

  recordLook(input: RecordLookInput): VideoLook {
    const createdAt = input.createdAt ?? this.now().toISOString();
    const frameHashes = input.frameHashes.filter((hash) => /^[0-9a-f]{16}$/i.test(hash)).slice(0, 64);
    const look = buildVideoLook({
      videoId: input.renderId,
      channelId: input.profileId ?? "none",
      createdAt,
      style: input.style,
      picks: input.picks,
      shotSec: input.shotSec,
      kindShare: input.kindShare,
      frameHashes,
    });
    const lookId = input.id ?? randomUUID();
    this.sqlite.prepare(`
      INSERT INTO video_looks (
        id, project_id, render_id, profile_id, pack_id, pack_version, fingerprint, look, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lookId,
      input.projectId,
      input.renderId,
      input.profileId,
      look.style.packId ?? "",
      look.style.packVersion,
      look.style.fingerprint,
      JSON.stringify(look),
      createdAt,
    );
    inheritWorkspace(this.sqlite, "video_looks", lookId, "projects", input.projectId);
    return look;
  }

  /** Newest finished videos first, capped at `window`. */
  lookHistory(profileId: string, window: number): LookHistory {
    const limit = Math.max(0, Math.floor(window));
    if (limit === 0) return { videos: [] };
    const rows = this.sqlite.prepare(
      "SELECT look FROM video_looks WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ).all(profileId, limit) as { look: string }[];
    return {
      videos: rows.map((row) => {
        const look = VideoLookSchema.parse(asJson(row.look));
        return {
          videoId: look.videoId,
          combos: look.combos.map((combo) => ({ templateId: combo.templateId, key: combo.key })),
        };
      }),
    };
  }

  /** Newest looks for the read API. `null` when the profile does not exist. */
  looksForProfile(profileId: string, limit: number): VideoLook[] | null {
    const exists = this.sqlite.prepare("SELECT 1 AS ok FROM profiles WHERE id = ?").get(profileId);
    if (!exists) return null;
    const capped = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.sqlite.prepare(
      "SELECT look FROM video_looks WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ).all(profileId, capped) as { look: string }[];
    return rows.map((row) => VideoLookSchema.parse(asJson(row.look)));
  }

  private initialPack(profile: ProfilePackRow): StylePack {
    const name = profile.name.trim().slice(0, 60) || "Kênh";
    const brand = parseHex(profile.color);
    const swatch = parseHex(PROFILE_SWATCH);
    if (brand && swatch && toHex(brand) !== toHex(swatch)) {
      return stylePackFromBrand({ id: profile.id, name, colors: [toHex(brand)] });
    }
    const preset = this.choosePreset();
    return StylePackSchema.parse({
      schema: 1,
      id: profile.id,
      name,
      version: 1,
      origin: { kind: "preset", presetId: preset.id },
      seed: profile.id,
      tokens: preset.tokens,
    });
  }

  /** First unused preset, then the least used one. */
  private choosePreset(): StylePreset {
    const rows = this.sqlite.prepare(`
      SELECT sp.origin AS origin FROM style_packs sp
      INNER JOIN (
        SELECT id, MAX(version) AS version FROM style_packs GROUP BY id
      ) latest ON latest.id = sp.id AND latest.version = sp.version
    `).all() as { origin: string }[];
    const counts = new Map(STYLE_PRESETS.map((preset) => [preset.id, 0]));
    for (const row of rows) {
      const origin = asJson<{ kind?: string; presetId?: string }>(row.origin);
      if (origin.kind === "preset" && origin.presetId && counts.has(origin.presetId)) {
        counts.set(origin.presetId, (counts.get(origin.presetId) ?? 0) + 1);
      }
    }
    const unused = STYLE_PRESETS.find((preset) => counts.get(preset.id) === 0);
    if (unused) return unused;
    return STYLE_PRESETS.reduce((best, preset) => (counts.get(preset.id)! < counts.get(best.id)! ? preset : best));
  }

  private insertPack(pack: StylePack): void {
    this.sqlite.prepare(
      `INSERT INTO style_packs (id, version, name, origin, seed, tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pack.id,
      pack.version,
      pack.name,
      JSON.stringify(pack.origin),
      pack.seed ?? null,
      JSON.stringify(pack.tokens),
      this.now().toISOString(),
    );
    stampWorkspace(this.sqlite, "style_packs", pack.id);
  }

  private toPack(row: PackRow): StylePack {
    return StylePackSchema.parse({
      schema: 1,
      id: row.id,
      name: row.name,
      version: row.version,
      origin: asJson(row.origin),
      ...(row.seed ? { seed: row.seed } : {}),
      tokens: asJson(row.tokens),
    });
  }
}
