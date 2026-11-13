import {
  createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes,
  type KeyObject,
} from "node:crypto";
import type { SealedSecret } from "@vg/shared";

/**
 * Seal a short secret for one node: X25519 key agreement, HKDF-SHA256, AES-256-GCM.
 * Built on Node `crypto` only. The node makes a fresh key pair for every lease request,
 * so a sealed secret can be opened once, by the node that asked, and by nobody who later reads the response.
 */
const INFO = Buffer.from("vg-node-secret-v1");

function importPublic(raw: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw }, format: "jwk" });
}

function deriveKey(shared: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), INFO, 32));
}

function aad(scope: string, expiresAt: string): Buffer {
  return Buffer.from(`${scope}|${expiresAt}`);
}

export type BoxKeyPair = { publicKey: string; privateKey: KeyObject };

/** A new key pair. `publicKey` is the 32-byte X25519 key as base64url, the form that goes in a lease request. */
export function newBoxKeyPair(): BoxKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return { publicKey: String(publicKey.export({ format: "jwk" }).x), privateKey };
}

export function isBoxPublicKey(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try {
    importPublic(value);
    return true;
  } catch {
    return false;
  }
}

export function sealSecret(plain: string, nodePublicKey: string, meta: { scope: string; label: string; expiresAt: string }): SealedSecret {
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: importPublic(nodePublicKey) });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(shared), iv);
  cipher.setAAD(aad(meta.scope, meta.expiresAt));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  shared.fill(0);
  return {
    scope: meta.scope,
    label: meta.label,
    expiresAt: meta.expiresAt,
    ephemeralPublicKey: String(ephemeral.publicKey.export({ format: "jwk" }).x),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

/** Open a sealed secret. Returns a Buffer so the caller can wipe it after use. */
export function openSecret(sealed: SealedSecret, privateKey: KeyObject): Buffer {
  const shared = diffieHellman({ privateKey, publicKey: importPublic(sealed.ephemeralPublicKey) });
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(shared), Buffer.from(sealed.iv, "base64url"));
  decipher.setAAD(aad(sealed.scope, sealed.expiresAt));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64url")), decipher.final()]);
  shared.fill(0);
  return plain;
}
