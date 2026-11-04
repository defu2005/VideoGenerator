import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { HostDownloadRateLimiter } from "../providers/images/rateLimiter.js";
import { parseRetryDelay, sleepWithAbort } from "../providers/images/retry.js";
import { projectDir } from "../storage/paths.js";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MIN_IMAGE_SIDE = 320;
const MAX_REDIRECTS = 3;
const IMAGE_FILE_PATTERN = /^[a-f0-9]{64}\.(jpg|png|webp|gif)$/;

export type ParsedImage = {
  fileType: "jpg" | "png" | "webp" | "gif";
  mimeType: string;
  width: number;
  height: number;
};

export type StoredImage = ParsedImage & {
  localPath: string;
  sha256: string;
  bytes: number;
  downloadedAt: string;
};

export class ImageDownloadError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
    public readonly host?: string,
  ) {
    super(message);
    this.name = "ImageDownloadError";
  }
}

export class ImageStore {
  private readonly hostRateLimiter: HostDownloadRateLimiter;

  constructor(
    private readonly dataDir: string,
    private readonly userAgent: string,
    private readonly dependencies: {
      fetchImpl?: typeof fetch;
      resolveHost?: (hostname: string) => Promise<string[]>;
      timeoutMs?: number;
      minIntervalMs?: number;
      hostRateLimiter?: HostDownloadRateLimiter;
    } = {},
  ) {
    this.hostRateLimiter = dependencies.hostRateLimiter ?? new HostDownloadRateLimiter(dependencies.minIntervalMs ?? 0);
  }

  async download(projectId: string, url: string, signal?: AbortSignal): Promise<StoredImage> {
    const bytes = await this.fetchImage(url, signal);
    return this.storeBuffer(projectId, bytes);
  }

  storeBuffer(projectId: string, bytes: Buffer): StoredImage {
    const image = parseImage(bytes);
    if (Math.min(image.width, image.height) < MIN_IMAGE_SIDE) {
      throw new ImageDownloadError(`Image is too small: ${image.width}x${image.height}; minimum short side is ${MIN_IMAGE_SIDE}px.`);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileName = `${sha256}.${image.fileType}`;
    const directory = join(projectDir(this.dataDir, projectId), "visuals");
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, fileName);
    if (!existsSync(filePath)) {
      try {
        writeFileSync(filePath, bytes, { flag: "wx" });
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      }
    }
    return {
      ...image,
      localPath: `visuals/${fileName}`,
      sha256,
      bytes: bytes.byteLength,
      downloadedAt: new Date().toISOString(),
    };
  }

  private async fetchImage(initialUrl: string, signal?: AbortSignal): Promise<Buffer> {
    const maxAttempts = 4;
    let networkRetried = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.fetchAttempt(initialUrl, signal);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (!(error instanceof ImageDownloadError)) {
          // Network errors and timeouts: retry once.
          if (networkRetried) throw new ImageDownloadError(`Image download failed after one retry: ${errorMessage(error)}.`);
          networkRetried = true;
          await sleepWithAbort(250, signal);
          continue;
        }
        if (!error.retryable) throw error;
        const host = error.host ?? new URL(initialUrl).hostname;
        if (attempt >= maxAttempts - 1) {
          // Still retryable: running approve-all again later may succeed.
          throw error.status === 429
            ? new ImageDownloadError("Máy chủ ảnh đang giới hạn tốc độ (HTTP 429) — thử lại sau ít phút", 429, true, error.retryAfterMs, host)
            : error;
        }
        // Shared per-host cooldown: the next request to this host (this retry or another download) waits it out.
        this.hostRateLimiter.cooldown(host, error.retryAfterMs ?? getRetryBackoff(attempt));
      }
    }
  }

  private async fetchAttempt(initialUrl: string, signal?: AbortSignal): Promise<Buffer> {
    const fetchImpl = this.dependencies.fetchImpl ?? fetch;
    let current = initialUrl;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const parsed = await this.validateUrl(current);
      await this.waitForHost(parsed.hostname, signal);
      const response = await fetchImpl(parsed, {
        headers: { "User-Agent": this.userAgent, Accept: "image/jpeg,image/png,image/webp,image/gif" },
        redirect: "manual",
        signal: AbortSignal.any([AbortSignal.timeout(this.dependencies.timeoutMs ?? 20_000), ...(signal ? [signal] : [])]),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new ImageDownloadError("Image redirect did not include a Location header.");
        if (redirect === MAX_REDIRECTS) throw new ImageDownloadError("Image exceeded the maximum of 3 redirects.");
        await response.body?.cancel();
        current = new URL(location, parsed).toString();
        continue;
      }
      if (response.status === 429 || response.status === 503) {
        const retryAfterMs = parseRetryDelay(response.headers.get("retry-after"));
        await response.body?.cancel();
        throw new ImageDownloadError(
          `Image server returned HTTP ${response.status}.`,
          response.status,
          true,
          retryAfterMs > 0 ? retryAfterMs : undefined,
          parsed.hostname,
        );
      }
      if (response.status >= 500) {
        await response.body?.cancel();
        throw new ImageDownloadError(`Image server returned HTTP ${response.status}.`, response.status, true, undefined, parsed.hostname);
      }
      if (!response.ok) throw new ImageDownloadError(`Image server returned HTTP ${response.status}.`, response.status, false, undefined, parsed.hostname);
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        await response.body?.cancel();
        throw new ImageDownloadError("Image exceeds the 25 MB download limit.");
      }
      const bytes = await readBoundedBody(response, MAX_IMAGE_BYTES);
      parseImage(bytes);
      return bytes;
    }
    throw new ImageDownloadError("Image exceeded the maximum of 3 redirects.");
  }

  private async waitForHost(hostname: string, signal?: AbortSignal): Promise<void> {
    await this.hostRateLimiter.acquire(hostname, signal);
  }

  private async validateUrl(value: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ImageDownloadError("Image URL is invalid.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ImageDownloadError("Only HTTP and HTTPS image URLs are allowed.");
    }
    if (url.username || url.password) throw new ImageDownloadError("Image URLs with embedded credentials are not allowed.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (isBlockedHostname(hostname)) throw new ImageDownloadError("Image URL points to a private, loopback, or link-local host.");
    const ipVersion = isIP(hostname);
    if (ipVersion === 0) {
      let addresses: string[];
      try {
        addresses = await (this.dependencies.resolveHost ?? defaultResolveHost)(hostname);
      } catch (error) {
        throw new ImageDownloadError(`Image host could not be resolved: ${errorMessage(error)}.`);
      }
      if (addresses.length === 0 || addresses.some(isBlockedHostname)) {
        throw new ImageDownloadError("Image URL resolves to a private, loopback, or link-local host.");
      }
    }
    return url;
  }
}

export function parseImage(bytes: Buffer): ParsedImage {
  let parsed: ParsedImage | undefined;
  if (bytes.length >= 57 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString("ascii", 12, 16) === "IHDR" && hasPngImageData(bytes)) {
    parsed = { fileType: "png", mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (bytes.length >= 14 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) && bytes.at(-1) === 0x3b) {
    parsed = { fileType: "gif", mimeType: "image/gif", width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  } else if (bytes.length >= 25 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
    && bytes.readUInt32LE(4) <= bytes.length - 8) {
    parsed = parseWebp(bytes);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dimensions = parseJpegDimensions(bytes);
    if (dimensions) parsed = { fileType: "jpg", mimeType: "image/jpeg", ...dimensions };
  }
  if (!parsed || parsed.width <= 0 || parsed.height <= 0) {
    throw new ImageDownloadError("Unsupported or invalid image data. Only valid JPEG, PNG, WebP, and GIF files are accepted.");
  }
  return parsed;
}

function parseJpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset++];
    if (marker === 0xd9) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (sofMarkers.has(marker)) {
      if (length < 7) return undefined;
      dimensions = { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === 0xda) {
      const endMarker = bytes.indexOf(Buffer.from([0xff, 0xd9]), offset + length);
      return dimensions && endMarker >= 0 ? dimensions : undefined;
    }
    offset += length;
  }

  return undefined;
}

function hasPngImageData(bytes: Buffer): boolean {
  let offset = 8;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") hasImageData = true;
    if (type === "IEND") return length === 0 && hasImageData;
    offset += length + 12;
  }
  return false;
}

function parseWebp(bytes: Buffer): { fileType: "webp"; mimeType: string; width: number; height: number } | undefined {
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      fileType: "webp", mimeType: "image/webp",
      width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21]; const b2 = bytes[22]; const b3 = bytes[23]; const b4 = bytes[24];
    return {
      fileType: "webp", mimeType: "image/webp",
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      fileType: "webp", mimeType: "image/webp",
      width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  return undefined;
}

async function readBoundedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new ImageDownloadError("Image response was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ImageDownloadError("Image exceeds the 25 MB download limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ImageDownloadError) throw error;
    throw error;
  }
  if (total === 0) throw new ImageDownloadError("Image response was empty.");
  return Buffer.concat(chunks, total);
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")
    || host === "metadata.google.internal") return true;
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (version === 6) {
    const groups = expandIpv6(host);
    if (!groups) return true;
    if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
      const ipv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
      return isBlockedHostname(ipv4);
    }
    if (groups.every((group) => group === 0) || groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
    const first = groups[0];
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
      || (first & 0xff00) === 0xff00;
  }
  return false;
}

function expandIpv6(value: string): number[] | undefined {
  let address = value.toLowerCase();
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4 = address.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return undefined;
    const octets = ipv4.split(".").map(Number);
    address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [leftValue, rightValue] = address.split("::");
  const left = leftValue ? leftValue.split(":") : [];
  const right = rightValue ? rightValue.split(":") : [];
  if (!address.includes("::") && left.length !== 8) return undefined;
  const zeros = address.includes("::") ? 8 - left.length - right.length : 0;
  if (zeros < 0 || (address.includes("::") && zeros < 1)) return undefined;
  const parts = [...left, ...Array.from({ length: zeros }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRetryBackoff(attempt: number): number {
  const backoff = [2_000, 5_000, 15_000];
  return backoff[Math.min(attempt, backoff.length - 1)] ?? 15_000;
}

export function isVisualFileName(value: string): boolean {
  return IMAGE_FILE_PATTERN.test(value);
}
