import { existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FootageFile, FootageHit } from "./types.js";

export const FOOTAGE_MAX_BYTES = 60 * 1024 * 1024;

export function pickFootageFile(files: FootageFile[], targetShortSide: number): FootageFile | null {
  const usable = files.filter((file) => file.url && file.width > 0 && file.height > 0 && (file.bytes ?? 0) <= FOOTAGE_MAX_BYTES);
  const bigEnough = usable
    .filter((file) => Math.min(file.width, file.height) >= targetShortSide)
    .sort((a, b) => (a.bytes ?? a.width * a.height) - (b.bytes ?? b.width * b.height) || a.height - b.height);
  return bigEnough[0]
    ?? [...usable].sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height))[0]
    ?? null;
}

export function footageCachePath(dataDir: string, hit: FootageHit, height: number): string {
  const id = hit.clipId.replace(/[^a-zA-Z0-9_-]/g, "");
  return join(dataDir, "footage", `${hit.provider}-${id}-${height}.mp4`);
}

export async function ensureFootage(
  dataDir: string,
  hit: FootageHit,
  targetShortSide: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ path: string | null; warning?: string }> {
  if (hit.durationSec > 60) return { path: null, warning: "Bỏ clip dài hơn 60 giây." };
  const file = pickFootageFile(hit.files.length ? hit.files : [{ url: hit.url, width: hit.width, height: hit.height }], targetShortSide);
  if (!file) return { path: null, warning: "Không có file footage." };
  const target = footageCachePath(dataDir, hit, file.height);
  if (existsSync(target) && statSync(target).size > 0) return { path: target };
  const response = await fetchImpl(file.url);
  if (!response.ok) return { path: null, warning: `Không tải được footage (${response.status}).` };
  const advertised = Number(response.headers.get("content-length") ?? "0");
  if (advertised > FOOTAGE_MAX_BYTES) return { path: null, warning: "Bỏ clip lớn hơn 60 MB." };
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > FOOTAGE_MAX_BYTES) return { path: null, warning: "Bỏ clip lớn hơn 60 MB." };
  await mkdir(dirname(target), { recursive: true });
  const part = `${target}.part`;
  try {
    await writeFile(part, body);
    await rename(part, target);
    return { path: target };
  } catch (error) {
    await rm(part, { force: true });
    return { path: null, warning: error instanceof Error ? error.message : "tải footage lỗi" };
  }
}
