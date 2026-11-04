import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { parseRetryDelay, sleepWithAbort } from "../providers/images/retry.js";
import { projectDir } from "../storage/paths.js";
import { defaultResolveHost, isBlockedHostname } from "./imageStore.js";

export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const AUDIO_FILE_PATTERN = /^[a-f0-9]{64}\.(mp3|ogg|wav|flac|m4a)$/;

export type AudioType = { ext: "mp3" | "ogg" | "wav" | "flac" | "m4a"; mimeType: string };
export type StoredAudio = AudioType & { localPath: string; sha256: string; bytes: number };

export class AudioDownloadError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryable = false) {
    super(message);
    this.name = "AudioDownloadError";
  }
}

/** Detect the audio container from its first bytes. Returns undefined for anything else (HTML, images…). */
export function sniffAudio(bytes: Buffer): AudioType | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { ext: "mp3", mimeType: "audio/mpeg" };
  }
  if (bytes.toString("ascii", 0, 4) === "OggS") return { ext: "ogg", mimeType: "audio/ogg" };
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return { ext: "wav", mimeType: "audio/wav" };
  if (bytes.toString("ascii", 0, 4) === "fLaC") return { ext: "flac", mimeType: "audio/flac" };
  if (bytes.toString("ascii", 4, 8) === "ftyp") return { ext: "m4a", mimeType: "audio/mp4" };
  return undefined;
}

export function isMusicFileName(value: string): boolean {
  return AUDIO_FILE_PATTERN.test(value);
}

export function audioMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ({ mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4" } as Record<string, string>)[ext ?? ""]
    ?? "application/octet-stream";
}

export class AudioStore {
  constructor(
    private readonly dataDir: string,
    private readonly userAgent: string,
    private readonly dependencies: {
      fetchImpl?: typeof fetch;
      resolveHost?: (hostname: string) => Promise<string[]>;
      timeoutMs?: number;
    } = {},
  ) {}

  async download(projectId: string, url: string, signal?: AbortSignal): Promise<StoredAudio> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return this.storeBuffer(projectId, await this.fetchAttempt(url, signal));
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (error instanceof AudioDownloadError && !error.retryable) throw error;
        lastError = error;
        if (attempt === 0) await sleepWithAbort(error instanceof AudioDownloadError && error.status === 429 ? 2_000 : 500, signal);
      }
    }
    if (lastError instanceof AudioDownloadError) throw lastError;
    throw new AudioDownloadError(`Tải nhạc thất bại: ${lastError instanceof Error ? lastError.message : String(lastError)}`, undefined, true);
  }

  storeBuffer(projectId: string, bytes: Buffer): StoredAudio {
    const type = sniffAudio(bytes);
    if (!type) throw new AudioDownloadError("Tệp không phải âm thanh hợp lệ (mp3, ogg, wav, flac, m4a).");
    if (bytes.byteLength > MAX_AUDIO_BYTES) throw new AudioDownloadError("Tệp nhạc vượt quá 30 MB.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileName = `${sha256}.${type.ext}`;
    const directory = join(projectDir(this.dataDir, projectId), "music");
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, fileName);
    if (!existsSync(filePath)) writeFileSync(filePath, bytes);
    return { ...type, localPath: `music/${fileName}`, sha256, bytes: bytes.byteLength };
  }

  private async fetchAttempt(initialUrl: string, signal?: AbortSignal): Promise<Buffer> {
    const fetchImpl = this.dependencies.fetchImpl ?? fetch;
    let current = initialUrl;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const parsed = await this.validateUrl(current);
      const response = await fetchImpl(parsed, {
        headers: { "User-Agent": this.userAgent, Accept: "audio/*" },
        redirect: "manual",
        signal: AbortSignal.any([AbortSignal.timeout(this.dependencies.timeoutMs ?? 60_000), ...(signal ? [signal] : [])]),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new AudioDownloadError("Chuyển hướng không có Location.");
        current = new URL(location, parsed).toString();
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const wait = parseRetryDelay(response.headers.get("retry-after"));
        await response.body?.cancel();
        if (wait > 0) await sleepWithAbort(Math.min(wait, 10_000), signal);
        throw new AudioDownloadError(`Máy chủ nhạc trả về HTTP ${response.status}.`, response.status, true);
      }
      if (!response.ok) throw new AudioDownloadError(`Máy chủ nhạc trả về HTTP ${response.status}.`, response.status, false);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
        await response.body?.cancel();
        throw new AudioDownloadError("Tệp nhạc vượt quá 30 MB.");
      }
      return readBounded(response);
    }
    throw new AudioDownloadError("Quá 3 lần chuyển hướng.");
  }

  private async validateUrl(value: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new AudioDownloadError("URL nhạc không hợp lệ.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new AudioDownloadError("Chỉ cho phép URL HTTP/HTTPS.");
    if (url.username || url.password) throw new AudioDownloadError("URL không được chứa thông tin đăng nhập.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const blocked = new AudioDownloadError("URL nhạc trỏ tới địa chỉ private, loopback hoặc link-local.");
    if (isBlockedHostname(hostname)) throw blocked;
    if (isIP(hostname) === 0) {
      let addresses: string[];
      try {
        addresses = await (this.dependencies.resolveHost ?? defaultResolveHost)(hostname);
      } catch (error) {
        throw new AudioDownloadError(`Không phân giải được máy chủ nhạc: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
      }
      if (addresses.length === 0 || addresses.some(isBlockedHostname)) throw blocked;
    }
    return url;
  }
}

async function readBounded(response: Response): Promise<Buffer> {
  if (!response.body) throw new AudioDownloadError("Phản hồi nhạc rỗng.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new AudioDownloadError("Tệp nhạc vượt quá 30 MB.");
    }
    chunks.push(value);
  }
  if (total === 0) throw new AudioDownloadError("Phản hồi nhạc rỗng.");
  return Buffer.concat(chunks, total);
}
