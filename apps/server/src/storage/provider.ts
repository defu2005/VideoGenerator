import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { presignS3, type S3Credentials } from "./sigv4.js";

export interface StorageUploadTarget {
  url: string;
  headers: Record<string, string>;
}

export interface StorageProvider {
  readonly id: "local" | "s3";
  put(key: string, localPath: string, sha256: string): Promise<void>;
  getDownloadUrl(key: string, ttlSec: number): Promise<string | null>;
  getUploadTarget(key: string, sha256: string, size: number, ttlSec: number): Promise<StorageUploadTarget | null>;
  head(key: string): Promise<{ size: number; sha256?: string } | null>;
  delete(key: string): Promise<void>;
  checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

export const S3_MAX_PUT_BYTES = 5_000_000_000;
export class StorageObjectTooLarge extends Error {}

function checksum(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid blob SHA-256");
  return Buffer.from(sha256, "hex").toString("base64");
}

export function blobKey(sha256: string): string {
  checksum(sha256);
  return `blobs/${sha256.slice(0, 2)}/${sha256}`;
}

/** With local storage, the existing project file remains the authoritative copy. */
export class LocalStorageProvider implements StorageProvider {
  readonly id = "local" as const;
  async put(_key: string, localPath: string): Promise<void> {
    if (!(await stat(localPath)).isFile()) throw new Error("Local artifact is not a file");
  }
  async getDownloadUrl() { return null; }
  async getUploadTarget() { return null; }
  async head() { return null; }
  async delete() { /* Project files are owned by the local project lifecycle. */ }
  async checkHealth() { return { ok: true, latencyMs: 0 }; }
}

export interface S3StorageOptions extends S3Credentials {
  endpoint: string;
  bucket: string;
  checksumSha256: boolean;
}

export class S3StorageProvider implements StorageProvider {
  readonly id = "s3" as const;
  private readonly endpoint: URL;

  constructor(
    private readonly options: S3StorageOptions,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    const endpoint = new URL(options.endpoint);
    if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error("Invalid S3 endpoint");
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket) || !/^[a-z0-9-]+$/.test(options.region)) {
      throw new Error("Invalid S3 bucket or region");
    }
    this.endpoint = endpoint;
  }

  private objectUrl(key: string): URL {
    const parts = key.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || /[\\\u0000-\u001f]/.test(part))) {
      throw new Error("Invalid S3 object key");
    }
    const url = new URL(this.endpoint);
    url.pathname = [url.pathname.replace(/\/$/, ""), this.options.bucket, ...parts.map(encodeURIComponent)].join("/");
    return url;
  }

  private sign(method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, ttlSec: number, headers?: Record<string, string>) {
    return presignS3(method, this.objectUrl(key), this.options, ttlSec, this.now(), headers);
  }

  private async send(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
    try {
      return await this.request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      // A fetch error or endpoint body can contain the complete signed URL.
      throw new Error("S3 request failed");
    }
  }

  async getDownloadUrl(key: string, ttlSec: number): Promise<string> {
    return this.sign("GET", key, ttlSec);
  }

  async getUploadTarget(key: string, sha256: string, size: number, ttlSec: number): Promise<StorageUploadTarget | null> {
    if (!Number.isSafeInteger(size) || size < 0 || size > S3_MAX_PUT_BYTES) return null;
    const digest = checksum(sha256);
    const headers: Record<string, string> = { "content-length": String(size) };
    if (this.options.checksumSha256) headers["x-amz-checksum-sha256"] = digest;
    return { url: this.sign("PUT", key, ttlSec, headers), headers };
  }

  async put(key: string, localPath: string, sha256: string): Promise<void> {
    const file = await stat(localPath);
    const target = file.isFile() && await this.getUploadTarget(key, sha256, file.size, 3600);
    if (!target) throw new Error("S3 file exceeds single PUT limit or is not a file");
    const stream = createReadStream(localPath);
    try {
      const init: RequestInit & { duplex: "half" } = {
        method: "PUT", headers: target.headers, body: Readable.toWeb(stream) as ReadableStream, duplex: "half",
      };
      if (file.size === 0) init.body = undefined;
      await this.expectOk(await this.send(target.url, init, 3600_000), "PUT");
    } finally {
      stream.destroy();
    }
  }

  async head(key: string): Promise<{ size: number; sha256?: string } | null> {
    const headers = this.options.checksumSha256 ? { "x-amz-checksum-mode": "ENABLED" } : undefined;
    const response = await this.send(this.sign("HEAD", key, 60, headers), { method: "HEAD", headers });
    if (response.status === 404) return null;
    await this.expectOk(response, "HEAD");
    const length = response.headers.get("content-length");
    if (!length || !/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) throw new Error("S3 HEAD returned an invalid size");
    const digest = response.headers.get("x-amz-checksum-sha256");
    return { size: Number(length), ...(digest && /^[A-Za-z0-9+/]{43}=$/.test(digest) ? { sha256: Buffer.from(digest, "base64").toString("hex") } : {}) };
  }

  async downloadTo(key: string, path: string, maxBytes: number): Promise<void> {
    const response = await this.send(this.sign("GET", key, 3600), { method: "GET" }, 3600_000);
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`S3 GET failed (HTTP ${response.status})`);
    }
    let bytes = 0;
    const bounded = async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new StorageObjectTooLarge("S3 object exceeds expected size");
        yield chunk;
      }
    };
    try {
      await pipeline(Readable.fromWeb(response.body as never), bounded, createWriteStream(path, { flags: "wx" }));
    } catch (error) {
      if (error instanceof StorageObjectTooLarge) throw error;
      throw new Error("S3 object download failed");
    }
  }

  async delete(key: string): Promise<void> {
    await this.expectOk(await this.send(this.sign("DELETE", key, 60), { method: "DELETE" }), "DELETE");
  }

  private async expectOk(response: Response, method: string): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new Error(`S3 ${method} failed (HTTP ${response.status})`);
  }

  async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.head("blobs/health-probe");
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : "S3 health check failed" };
    }
  }
}
