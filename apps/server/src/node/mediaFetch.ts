import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Job, MediaBundle } from "@vg/shared";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { StageContext, StageExecutor } from "../pipeline/stageExecutor.js";
import { ensureFootage, FOOTAGE_MAX_BYTES } from "../providers/footage/download.js";
import type { FootageHit } from "../providers/footage/types.js";
import { buildMediaBundle, mediaTargetName, type MediaItemInput } from "./remoteBundle.js";

/**
 * MEDIA_FETCH (TASK-120): download stock footage into `data/footage/`, here or on a worker node.
 * The file URLs are public, so this job carries no secret at all. The job's `scope` holds the items.
 */
const ItemSchema = z.object({
  provider: z.enum(["pexels", "pixabay"]),
  clipId: z.string(),
  url: z.string().url(),
  width: z.number(),
  height: z.number(),
  durationSec: z.number(),
  bytes: z.number().optional(),
  author: z.string(),
  licenseName: z.string(),
  pageUrl: z.string(),
});
const ScopeSchema = z.object({ targetShortSide: z.number().int().positive(), items: z.array(ItemSchema).min(1).max(40) });
export type MediaFetchScope = z.infer<typeof ScopeSchema>;

export function parseMediaScope(scope: string | null): MediaFetchScope | null {
  if (!scope) return null;
  try {
    return ScopeSchema.parse(JSON.parse(scope));
  } catch {
    return null;
  }
}

function hitOf(item: MediaItemInput): FootageHit {
  return {
    provider: item.provider,
    clipId: item.clipId,
    url: item.url,
    width: item.width,
    height: item.height,
    durationSec: item.durationSec,
    author: item.author,
    licenseName: item.licenseName,
    pageUrl: item.pageUrl,
    previewImage: "",
    tags: [],
    files: [{ url: item.url, width: item.width, height: item.height, ...(item.bytes !== undefined ? { bytes: item.bytes } : {}) }],
  };
}

export function footageTargetPath(dataDir: string, name: string): string {
  return join(dataDir, "footage", name.replace(/^media\//, ""));
}

/** An MP4 starts with an `ftyp` box at byte 4. Cheap proof that a node did not upload something else. */
export function looksLikeMp4(path: string): boolean {
  try {
    const head = readFileSync(path).subarray(4, 8).toString("latin1");
    return head === "ftyp";
  } catch {
    return false;
  }
}

export class MediaFetchService {
  constructor(private readonly jobs: JobRepository, private readonly dataDir: string) {}

  enqueue(projectId: string, items: MediaItemInput[], targetShortSide: number): Job {
    const scope: MediaFetchScope = { targetShortSide, items };
    return this.jobs.createJob({
      projectId,
      stage: "MEDIA_FETCH",
      maxAttempts: 2,
      previousState: "PENDING",
      scope: JSON.stringify(ScopeSchema.parse(scope)),
    });
  }

  bundleFor(scope: MediaFetchScope): MediaBundle {
    return buildMediaBundle(scope.items, scope.targetShortSide, FOOTAGE_MAX_BYTES);
  }

  /** Items the cache does not hold yet. A remote job only asks for these. */
  missing(scope: MediaFetchScope): MediaItemInput[] {
    return scope.items.filter((item) => !existsSync(footageTargetPath(this.dataDir, mediaTargetName(item))));
  }

  /**
   * Take a verified node upload into the footage cache. The caller already checked sha256 and size against the report;
   * here we check the size limit and the MP4 signature, then move the file into place atomically.
   */
  place(name: string, uploadedPath: string, expected: { sha256: string; size: number }): void {
    const size = statSync(uploadedPath).size;
    const sha256 = createHash("sha256").update(readFileSync(uploadedPath)).digest("hex");
    if (size !== expected.size || sha256 !== expected.sha256) throw new Error(`Tệp ${name} không khớp báo cáo của node.`);
    if (size > FOOTAGE_MAX_BYTES) throw new Error(`Tệp ${name} lớn hơn giới hạn.`);
    if (!looksLikeMp4(uploadedPath)) throw new Error(`Tệp ${name} không phải video MP4.`);
    const target = footageTargetPath(this.dataDir, name);
    mkdirSync(dirname(target), { recursive: true });
    const part = `${target}.part`;
    copyFileSync(uploadedPath, part);
    try {
      renameSync(part, target);
    } catch (error) {
      rmSync(part, { force: true });
      throw error;
    }
  }
}

/** The local path: the job runs here, with the same download code the render uses. */
export class MediaFetchExecutor implements StageExecutor {
  readonly stage = "MEDIA_FETCH" as const;

  constructor(private readonly dataDir: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async run(context: StageContext) {
    const scope = parseMediaScope(context.job.scope);
    if (!scope) return { message: "Không có clip nào để tải." };
    let done = 0;
    let skipped = 0;
    for (const [index, item] of scope.items.entries()) {
      if (context.signal.aborted) break;
      const got = await ensureFootage(this.dataDir, hitOf(item), scope.targetShortSide, this.fetchImpl);
      if (got.path) done += 1;
      else skipped += 1;
      context.reportProgress(Math.round(((index + 1) / scope.items.length) * 100), `Tải clip ${index + 1}/${scope.items.length}`);
    }
    return { message: `${done} clip đã có trong kho, ${skipped} bỏ qua` };
  }
}
