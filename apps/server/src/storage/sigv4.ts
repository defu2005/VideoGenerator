import { createHash, createHmac } from "node:crypto";

export interface S3Credentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

/** AWS S3 SigV4 query authentication, using UNSIGNED-PAYLOAD with optional signed checksum. */
export function presignS3(
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  objectUrl: URL,
  credentials: S3Credentials,
  ttlSec: number,
  now: Date,
  headers: Readonly<Record<string, string>> = {},
): string {
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > 604800) throw new Error("Invalid S3 URL lifetime");
  const url = new URL(objectUrl);
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const scope = `${day}/${credentials.region}/s3/aws4_request`;
  const canonicalHeaders = new Map([["host", url.host]]);
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name) || canonicalHeaders.has(name) || /[\r\n]/.test(rawValue)) {
      throw new Error("Invalid S3 signed header");
    }
    canonicalHeaders.set(name, rawValue.trim().replace(/\s+/g, " "));
  }
  const names = [...canonicalHeaders.keys()].sort();
  const headerBlock = names.map((name) => `${name}:${canonicalHeaders.get(name)}\n`).join("");
  const signedHeaders = names.join(";");
  const params = new URLSearchParams(url.search);
  for (const key of params.keys()) {
    if (/^x-amz-/i.test(key)) throw new Error("S3 object URL already has authentication parameters");
  }
  params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  params.set("X-Amz-Credential", `${credentials.accessKeyId}/${scope}`);
  params.set("X-Amz-Date", date);
  params.set("X-Amz-Expires", String(ttlSec));
  params.set("X-Amz-SignedHeaders", signedHeaders);
  const query = [...params.entries()].map(([key, value]) => `${encode(key)}=${encode(value)}`).sort().join("&");
  const path = url.pathname.split("/").map((segment) => encode(decodeURIComponent(segment))).join("/");
  const canonical = [method, path, query, headerBlock, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const digest = createHash("sha256").update(canonical).digest("hex");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), "s3"), "aws4_request");
  const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${digest}`).toString("hex");
  return `${url.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}
