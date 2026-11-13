import type Database from "better-sqlite3";
import { createUserRequest } from "../operator/autopilot.js";

export type VisualCopyrightMode = "off" | "commentary";
export type VisualQuality = "budget" | "best";

const keyFor = (profileId: string) => `profile.visuals.${profileId}`;

type StoredVisuals = { allowCopyrightedStills?: string; quality?: string };

function readStored(sqlite: Database.Database, profileId: string): StoredVisuals {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(keyFor(profileId)) as { value: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.value) as StoredVisuals;
  } catch {
    return {};
  }
}

function writeStored(sqlite: Database.Database, profileId: string, value: StoredVisuals, now = new Date()): void {
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(keyFor(profileId), JSON.stringify(value), now.toISOString());
}

export function visualCopyrightMode(sqlite: Database.Database, profileId: string | null | undefined): VisualCopyrightMode {
  if (!profileId) return "off";
  return readStored(sqlite, profileId).allowCopyrightedStills === "commentary" ? "commentary" : "off";
}

export function setVisualCopyrightMode(sqlite: Database.Database, profileId: string, mode: VisualCopyrightMode, now = new Date()): void {
  writeStored(sqlite, profileId, { ...readStored(sqlite, profileId), allowCopyrightedStills: mode }, now);
}

export function visualQuality(sqlite: Database.Database, profileId: string | null | undefined): VisualQuality {
  if (!profileId) return "budget";
  return readStored(sqlite, profileId).quality === "best" ? "best" : "budget";
}

export function setVisualQuality(sqlite: Database.Database, profileId: string, quality: VisualQuality, now = new Date()): void {
  writeStored(sqlite, profileId, { ...readStored(sqlite, profileId), quality }, now);
}

export function setAllProfilesVisualQuality(sqlite: Database.Database, quality: VisualQuality, now = new Date()): number {
  const rows = sqlite.prepare("SELECT id FROM profiles").all() as Array<{ id: string }>;
  for (const row of rows) setVisualQuality(sqlite, row.id, quality, now);
  return rows.length;
}

/** One open "Cần bạn" per project when web image search cannot run. */
export function copyrightChecklist(sqlite: Database.Database, projectId: string): string[] {
  const rows = sqlite.prepare(`SELECT c.score_breakdown AS score FROM visual_selections s
    JOIN visual_candidates c ON c.id = s.candidate_id WHERE s.project_id = ?`).all(projectId) as Array<{ score: string }>;
  let count = 0;
  for (const row of rows) {
    try {
      const parsed = typeof row.score === "string" ? JSON.parse(row.score) as { usage?: string } : row.score;
      if (parsed?.usage === "commentary") count += 1;
    } catch {
      // A broken score row does not hide the rest of the checklist.
    }
  }
  return count > 0 ? [`Video có ảnh có bản quyền — rủi ro Content ID (${count})`] : [];
}

export function noteMissingDistinctVisual(sqlite: Database.Database, projectId: string, count: number): void {
  const project = sqlite.prepare("SELECT title, profile_id FROM projects WHERE id = ?").get(projectId) as
    { title: string; profile_id: string | null } | undefined;
  createUserRequest(sqlite, {
    profileId: project?.profile_id,
    kind: "info",
    title: "Cảnh chưa có ảnh riêng",
    whyVi: `${count} cảnh chưa có ảnh khác với các cảnh còn lại.`,
    actionUrl: `/projects/${projectId}/overview`,
    dedupeKey: `visual-distinct:${projectId}`,
    checkKind: "visual_search",
  });
}

export function noteVisualSearchUnavailable(sqlite: Database.Database, projectId: string): void {
  const project = sqlite.prepare("SELECT title, profile_id FROM projects WHERE id = ?").get(projectId) as
    { title: string; profile_id: string | null } | undefined;
  createUserRequest(sqlite, {
    profileId: project?.profile_id,
    kind: "info",
    title: "Ảnh cảnh còn lệch chủ đề",
    whyVi: "Tìm kiếm web đang tắt hoặc chưa có khóa, nên ảnh lệch chủ đề chưa được tìm lại.",
    actionUrl: `/projects/${projectId}/overview`,
    dedupeKey: `visual-search:${projectId}`,
    checkKind: "visual_search",
  });
}
