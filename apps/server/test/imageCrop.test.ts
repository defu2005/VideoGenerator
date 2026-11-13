import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { cropSceneImage } from "../src/services/imageCrop.js";
import { projectDir } from "../src/storage/paths.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("image crop", () => {
  it("crops a 16:9 image to 9/10 of each side and leaves the original", async () => {
    if (!ffmpegPath) {
      console.info("Bỏ qua: ffmpeg-static không có binary trên máy này.");
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "vg-crop-"));
    roots.push(root);
    const source = join(root, "wide.png");
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080", "-frames:v", "1", source]);
    const opened = openDatabase(join(root, "app.db"));
    migrateDatabase(opened.db);
    const ids = seed(opened.sqlite, root, source, 1920, 1080);
    const before = statSync(join(projectDir(root, ids.projectId), "visuals", "wide.png")).size;
    const cropped = await cropSceneImage(opened.sqlite, {
      dataDir: root,
      projectId: ids.projectId,
      sceneId: ids.sceneId,
      aspect: "16:9",
      renderWidth: 1920,
      renderHeight: 1080,
    });
    expect(statSync(join(projectDir(root, ids.projectId), "visuals", "wide.png")).size).toBe(before);
    expect(cropped.width).toBe(1728);
    expect(cropped.height).toBe(972);
    expect(cropped.lowRes).toBe(true);
    const size = await frameSize(cropped.path);
    expect(size).toEqual({ width: 1728, height: 972 });
    opened.sqlite.close();
  });

  it("crops a 4:3 image to the widest 16:9 box", async () => {
    if (!ffmpegPath) return;
    const root = mkdtempSync(join(tmpdir(), "vg-crop-"));
    roots.push(root);
    const source = join(root, "four-three.png");
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=400x300", "-frames:v", "1", source]);
    const opened = openDatabase(join(root, "app.db"));
    migrateDatabase(opened.db);
    const ids = seed(opened.sqlite, root, source, 400, 300);
    const cropped = await cropSceneImage(opened.sqlite, {
      dataDir: root,
      projectId: ids.projectId,
      sceneId: ids.sceneId,
      aspect: "16:9",
    });
    expect(cropped.width).toBe(400);
    expect(cropped.rule).toBe("fit_ratio");
    const size = await frameSize(cropped.path);
    expect(size.width).toBe(400);
    opened.sqlite.close();
  });

  it("keeps a manual crop when the batch runs again", async () => {
    if (!ffmpegPath) return;
    const root = mkdtempSync(join(tmpdir(), "vg-crop-"));
    roots.push(root);
    const source = join(root, "wide.png");
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080", "-frames:v", "1", source]);
    const opened = openDatabase(join(root, "app.db"));
    migrateDatabase(opened.db);
    const ids = seed(opened.sqlite, root, source, 1920, 1080);
    const manual = await cropSceneImage(opened.sqlite, {
      dataDir: root,
      projectId: ids.projectId,
      sceneId: ids.sceneId,
      aspect: "16:9",
      box: { x: 20, y: 10, width: 1600, height: 900 },
      overwriteManual: true,
    });
    const again = await cropSceneImage(opened.sqlite, {
      dataDir: root,
      projectId: ids.projectId,
      sceneId: ids.sceneId,
      aspect: "16:9",
    });
    expect(manual.manual).toBe(true);
    expect(again.box).toEqual(manual.box);
    expect(again.manual).toBe(true);
    opened.sqlite.close();
  });
});

function seed(sqlite: import("better-sqlite3").Database, dataDir: string, file: string, width: number, height: number) {
  const now = new Date().toISOString();
  const projectId = "33333333-3333-4333-8333-333333333333";
  const sceneId = "44444444-4444-4444-8444-444444444444";
  const candidateId = "55555555-5555-4555-8555-555555555555";
  const visuals = join(projectDir(dataDir, projectId), "visuals");
  mkdirSync(visuals, { recursive: true });
  const name = basename(file);
  copyFileSync(file, join(visuals, name));
  sqlite.prepare(`INSERT INTO projects (id, title, topic, mode, settings, status, stage, created_at, updated_at)
    VALUES (?, 'Cắt', 'cắt', 'MANUAL', '{}', 'DRAFT', 'VISUAL_REVIEW', ?, ?)`).run(projectId, now, now);
  sqlite.prepare(`INSERT INTO scenes (id, project_id, "order", kind, label, narration, visual_notes, visual_queries, music_mood, energy, est_duration_sec, start_sec, transition_note, origin, input_hash, created_at, updated_at)
    VALUES (?, ?, 0, 'NARRATION', 'cảnh', 'lời', '', '{"primary":"a","alternatives":[]}', 'calm', 'low', 5, 0, '', 'AGENT', 'hash', ?, ?)`).run(sceneId, projectId, now, now);
  sqlite.prepare(`INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, query, title, description, tags, preview_url, image_url, source_url, source_site, width, height, aspect_ratio, file_type, watermark, relevance_score, score_breakdown, license, rank, local_path, actual_width, actual_height, created_at, search_hash)
    VALUES (?, ?, ?, 'SEARCH', 'mock', 'item', 'a', 'ảnh', '', '[]', 'https://images.test/a.jpg', 'https://images.test/a.jpg', 'https://source.test/a', 'test', ?, ?, ?, 'png', 'NONE', 1, '{}', '{}', 0, ?, ?, ?, ?, 'hash')`)
    .run(candidateId, projectId, sceneId, width, height, width / height, `visuals/${name}`, width, height, now);
  sqlite.prepare(`INSERT INTO visual_selections (id, project_id, scene_id, slot, candidate_id, status, selected_by, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, 'APPROVED', 'AGENT', ?, ?)`).run("66666666-6666-4666-8666-666666666666", projectId, sceneId, candidateId, now, now);
  return { projectId, sceneId };
}

function execFileAsync(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(file, args, (error) => error ? reject(error) : resolve());
  });
}

function frameSize(file: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath!, ["-hide_banner", "-i", file], (error, _stdout, stderr) => {
      const match = String(stderr ?? (error as { stderr?: string } | null)?.stderr ?? "").match(/, (\d+)x(\d+)/);
      if (!match) reject(error ?? new Error("Không đọc được kích thước ảnh."));
      else resolve({ width: Number(match[1]), height: Number(match[2]) });
    });
  });
}
