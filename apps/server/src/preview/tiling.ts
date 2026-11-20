import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeDrawtextPath } from "@vg/shared";

/**
 * Contact-sheet tiling in one ffmpeg pass (`tile` filter).
 * Shared helper: TASK-090 and later contact-sheet users should call this instead of writing their own.
 * Input is an image sequence `<dir>/<prefix>%04d.jpg` numbered from 1, in reading order.
 */

export type TileOptions = {
  count: number;
  columns: number;
  tileWidth: number;
  tileHeight: number;
  /** One short label per tile, burned in the top-left corner. Needs `fontFile`. */
  labels?: string[];
  fontFile?: string;
  /** Where label text files are written. */
  workDir: string;
  gap?: number;
};

export function tileGrid(count: number, columns: number): { columns: number; rows: number } {
  const cols = Math.max(1, Math.min(columns, Math.max(1, count)));
  return { columns: cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

/** Picks a tile size that keeps the sheet readable: wide enough for text, short enough to view whole. */
export function tileSizeFor(count: number, columns: number, aspect: { width: number; height: number }): { tileWidth: number; tileHeight: number } {
  const { rows } = tileGrid(count, columns);
  let tileWidth = aspect.width >= aspect.height ? 224 : 160;
  const ratio = aspect.height / aspect.width;
  while (tileWidth > 96 && rows * Math.round(tileWidth * ratio) > 4200) tileWidth -= 16;
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { tileWidth: even(tileWidth), tileHeight: even(tileWidth * ratio) };
}

/** Writes the filter script and returns its path plus the output size of the finished sheet. */
export function writeTileFilter(options: TileOptions): { scriptPath: string; width: number; height: number } {
  const gap = options.gap ?? 2;
  const { columns, rows } = tileGrid(options.count, options.columns);
  mkdirSync(options.workDir, { recursive: true });
  const parts: string[] = [
    `scale=${options.tileWidth}:${options.tileHeight}:force_original_aspect_ratio=decrease`,
    `pad=${options.tileWidth}:${options.tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
  ];
  if (options.fontFile && options.labels?.length) {
    const font = escapeDrawtextPath(options.fontFile);
    options.labels.slice(0, options.count).forEach((label, index) => {
      const file = join(options.workDir, `label-${index}.txt`);
      writeFileSync(file, label);
      parts.push(
        `drawtext=fontfile='${font}':textfile='${escapeDrawtextPath(file)}':expansion=none:fontsize=${Math.max(9, Math.round(options.tileHeight * 0.1))}`
        + `:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=2:x=3:y=3:enable='eq(n,${index})'`,
      );
    });
  }
  parts.push(`tile=${columns}x${rows}:padding=${gap}:margin=${gap}:color=0x202020`);
  const scriptPath = join(options.workDir, "tile.filter.txt");
  writeFileSync(scriptPath, `[0:v]${parts.join(",")}[out]`);
  return {
    scriptPath,
    width: columns * options.tileWidth + (columns + 1) * gap,
    height: rows * options.tileHeight + (rows + 1) * gap,
  };
}

/** ffmpeg arguments that turn the numbered JPEG sequence into one sheet. */
export function tileArgs(sequencePattern: string, scriptPath: string, outPath: string): string[] {
  return [
    "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
    "-framerate", "1", "-start_number", "1", "-i", sequencePattern,
    "-filter_complex_script", scriptPath,
    "-map", "[out]", "-frames:v", "1", "-q:v", "4", outPath,
  ];
}
