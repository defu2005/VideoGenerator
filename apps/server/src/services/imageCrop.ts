import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { planCrop, type CropBox } from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { resolveAssetPath } from "../storage/paths.js";

const execFileAsync = promisify(execFile);

const ASPECTS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 } as const;
export type CropAspect = keyof typeof ASPECTS;

export type CropRecord = {
  path: string;
  box: CropBox;
  rule: "fit_ratio" | "same_ratio_scale";
  focusSource: "user" | "vision" | "smartcrop" | "center";
  width: number;
  height: number;
  lowRes: boolean;
  manual: boolean;
  warning: string | null;
};

export async function cropProjectImages(
  sqlite: Database.Database,
  input: { dataDir: string; projectId: string; sceneIds?: string[]; aspects: CropAspect[]; overwriteManual?: boolean },
): Promise<CropRecord[]> {
  const scenes = input.sceneIds ?? (sqlite.prepare(
    "SELECT scene_id AS sceneId FROM visual_selections WHERE project_id = ? AND slot = 0",
  ).all(input.projectId) as Array<{ sceneId: string }>).map((row) => row.sceneId);
  const records: CropRecord[] = [];
  for (const sceneId of scenes) {
    for (const aspect of input.aspects) {
      records.push(await cropSceneImage(sqlite, {
        dataDir: input.dataDir,
        projectId: input.projectId,
        sceneId,
        aspect,
        overwriteManual: input.overwriteManual,
      }));
    }
  }
  return records;
}

export function deleteSceneCrop(sqlite: Database.Database, projectId: string, sceneId: string, aspect: CropAspect): void {
  const project = sqlite.prepare("SELECT status FROM projects WHERE id = ?").get(projectId) as { status: string } | undefined;
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Không thấy dự án.");
  if (project.status === "RENDERING" || project.status === "GENERATING") {
    throw new AppError(409, "PROJECT_BUSY", "Dự án đang chạy hoặc đang render, không xoá ảnh cắt.");
  }
  sqlite.prepare("DELETE FROM visual_crops WHERE scene_id = ? AND aspect = ?").run(sceneId, aspect);
}

export async function cropSceneImage(
  sqlite: Database.Database,
  input: {
    projectId: string;
    sceneId: string;
    aspect: CropAspect;
    dataDir: string;
    box?: CropBox;
    overwriteManual?: boolean;
    renderWidth?: number;
    renderHeight?: number;
  },
): Promise<CropRecord> {
  if (!ffmpegPath) throw new AppError(503, "FFMPEG_MISSING", "Máy không có ffmpeg để cắt ảnh.");
  const project = sqlite.prepare("SELECT status FROM projects WHERE id = ?").get(input.projectId) as { status: string } | undefined;
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Không thấy dự án.");
  if (project.status === "RENDERING" || project.status === "GENERATING") {
    throw new AppError(409, "PROJECT_BUSY", "Dự án đang chạy hoặc đang render, không cắt ảnh.");
  }
  const source = sqlite.prepare(`SELECT c.id, c.local_path AS localPath, c.width, c.height,
      c.actual_width AS actualWidth, c.actual_height AS actualHeight, c.file_type AS fileType, c.vision_check AS visionCheck
    FROM visual_selections sel JOIN visual_candidates c ON c.id = sel.candidate_id
    WHERE sel.project_id = ? AND sel.scene_id = ? AND sel.slot = 0`).get(input.projectId, input.sceneId) as {
    id: string;
    localPath: string | null;
    width: number;
    height: number;
    actualWidth: number | null;
    actualHeight: number | null;
    fileType: string;
    visionCheck: string | null;
  } | undefined;
  if (!source?.localPath) {
    throw new AppError(422, "CROP_SOURCE_MISSING", "Cảnh chưa có file ảnh gốc.");
  }
  let absolute: string;
  try {
    absolute = resolveAssetPath(input.dataDir, input.projectId, source.localPath);
  } catch {
    throw new AppError(422, "CROP_SOURCE_MISSING", "Cảnh chưa có file ảnh gốc.");
  }
  if (!existsSync(absolute)) {
    throw new AppError(422, "CROP_SOURCE_MISSING", "Cảnh chưa có file ảnh gốc.");
  }
  const existing = sqlite.prepare("SELECT * FROM visual_crops WHERE candidate_id = ? AND aspect = ?")
    .get(source.id, input.aspect) as { manual: number; output_path: string; box_x: number; box_y: number; box_w: number; box_h: number; rule: string; focus_source: string; output_width: number; output_height: number; low_res: number } | undefined;
  if (existing?.manual && !input.overwriteManual && !input.box) {
    return toRecord(existing);
  }
  const width = source.actualWidth ?? source.width;
  const height = source.actualHeight ?? source.height;
  const before = statSync(absolute);
  const planned = input.box
    ? { box: clampBox(input.box, width, height), rule: "fit_ratio" as const, keepsSubject: true }
    : planCrop({
      width,
      height,
      targetAspect: ASPECTS[input.aspect],
      ...focusFromVision(source.visionCheck, width, height),
    });
  const ext = source.fileType === "png" || extname(absolute).toLowerCase() === ".png" ? "png" : "jpg";
  const output = join(dirname(absolute), `${source.id}.crop-${input.aspect.replace(":", "x")}.${ext}`);
  const filter = `crop=${planned.box.width}:${planned.box.height}:${planned.box.x}:${planned.box.y}`;
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", absolute, "-vf", filter, "-frames:v", "1"];
  if (ext === "jpg") args.push("-q:v", "2");
  args.push(output);
  await execFileAsync(ffmpegPath, args, { timeout: 20_000 });
  const after = statSync(absolute);
  if (after.size !== before.size) {
    throw new AppError(500, "CROP_ORIGINAL_CHANGED", "File gốc bị đổi khi cắt.");
  }
  const lowRes = Boolean(input.renderWidth && planned.box.width < input.renderWidth)
    || Boolean(input.renderHeight && planned.box.height < input.renderHeight);
  const focusSource = input.box ? "user" : (focusFromVision(source.visionCheck, width, height).focus ? "vision" : "center");
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO visual_crops
      (id, candidate_id, scene_id, aspect, box_x, box_y, box_w, box_h, rule, focus_source, manual, output_path, output_width, output_height, low_res, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id, aspect) DO UPDATE SET
      box_x = excluded.box_x, box_y = excluded.box_y, box_w = excluded.box_w, box_h = excluded.box_h,
      rule = excluded.rule, focus_source = excluded.focus_source, manual = excluded.manual,
      output_path = excluded.output_path, output_width = excluded.output_width, output_height = excluded.output_height,
      low_res = excluded.low_res, created_at = excluded.created_at`)
    .run(
      randomUUID(), source.id, input.sceneId, input.aspect,
      planned.box.x, planned.box.y, planned.box.width, planned.box.height,
      planned.rule, focusSource, input.box ? 1 : 0, output, planned.box.width, planned.box.height, lowRes ? 1 : 0, now,
    );
  return {
    path: output,
    box: planned.box,
    rule: planned.rule,
    focusSource,
    width: planned.box.width,
    height: planned.box.height,
    lowRes,
    manual: Boolean(input.box),
    warning: planned.keepsSubject ? null : "Ảnh cắt có thể mất chủ thể — xem lại khung cắt",
  };
}

function toRecord(row: { output_path: string; box_x: number; box_y: number; box_w: number; box_h: number; rule: string; focus_source: string; output_width: number; output_height: number; low_res: number; manual: number }): CropRecord {
  return {
    path: row.output_path,
    box: { x: row.box_x, y: row.box_y, width: row.box_w, height: row.box_h },
    rule: row.rule === "same_ratio_scale" ? "same_ratio_scale" : "fit_ratio",
    focusSource: row.focus_source === "user" || row.focus_source === "vision" || row.focus_source === "smartcrop" ? row.focus_source : "center",
    width: row.output_width,
    height: row.output_height,
    lowRes: Boolean(row.low_res),
    manual: Boolean(row.manual),
    warning: null,
  };
}

function clampBox(box: CropBox, width: number, height: number): CropBox {
  const nextWidth = Math.min(box.width, width);
  const nextHeight = Math.min(box.height, height);
  return {
    x: Math.max(0, Math.min(box.x, width - nextWidth)),
    y: Math.max(0, Math.min(box.y, height - nextHeight)),
    width: nextWidth,
    height: nextHeight,
  };
}

function focusFromVision(raw: string | null, width: number, height: number): { focus?: { x: number; y: number }; subjectBox?: CropBox } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { subject?: { x: number; y: number; width: number; height: number } };
    const subject = parsed.subject;
    if (!subject) return {};
    return {
      focus: { x: subject.x + subject.width / 2, y: subject.y + subject.height / 2 },
      subjectBox: {
        x: Math.round(subject.x * width),
        y: Math.round(subject.y * height),
        width: Math.round(subject.width * width),
        height: Math.round(subject.height * height),
      },
    };
  } catch {
    return {};
  }
}
