import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import type { TokenSet } from "@vg/shared";
import { TokenSetSchema } from "@vg/shared";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;

export type StoredAppCredentials = {
  clientId: string;
  clientSecret: string;
};

export class TokenVault {
  private key: Buffer | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly dataDir: string,
    private readonly encryptionKeyBase64?: string,
  ) {}

  /** Encrypt and store OAuth tokens for an account. Never logs plaintext. */
  storeTokens(accountId: string, tokens: TokenSet, scopes?: string[]): void {
    const parsed = TokenSetSchema.parse(tokens);
    const payload = JSON.stringify(parsed);
    const { ciphertext, iv, authTag } = this.encrypt(payload);
    const now = new Date().toISOString();
    const scopeList = scopes ?? parsed.scopes ?? [];
    this.sqlite.prepare(
      `INSERT INTO platform_credentials (account_id, ciphertext, iv, auth_tag, scopes, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         scopes = excluded.scopes,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    ).run(
      accountId,
      ciphertext,
      iv,
      authTag,
      JSON.stringify(scopeList),
      parsed.expiresAt ?? null,
      now,
    );
  }

  loadTokens(accountId: string): TokenSet | null {
    const row = this.sqlite.prepare(
      "SELECT ciphertext, iv, auth_tag FROM platform_credentials WHERE account_id = ?",
    ).get(accountId) as { ciphertext: string; iv: string; auth_tag: string } | undefined;
    if (!row) return null;
    const plaintext = this.decrypt(row.ciphertext, row.iv, row.auth_tag);
    return TokenSetSchema.parse(JSON.parse(plaintext) as unknown);
  }

  deleteTokens(accountId: string): void {
    this.sqlite.prepare("DELETE FROM platform_credentials WHERE account_id = ?").run(accountId);
  }

  getCredentialMeta(accountId: string): { scopes: string[]; expiresAt: string | null; updatedAt: string } | null {
    const row = this.sqlite.prepare(
      "SELECT scopes, expires_at, updated_at FROM platform_credentials WHERE account_id = ?",
    ).get(accountId) as { scopes: string; expires_at: string | null; updated_at: string } | undefined;
    if (!row) return null;
    const scopes = typeof row.scopes === "string" ? JSON.parse(row.scopes) as string[] : [];
    return { scopes, expiresAt: row.expires_at, updatedAt: row.updated_at };
  }

  storeAppCredentials(
    input: { accountId?: string; profileId?: string; platform: string; credentials: StoredAppCredentials },
  ): { idHint: string } {
    if (!input.accountId && !input.profileId) {
      throw new Error("storeAppCredentials requires accountId or profileId");
    }
    const payload = JSON.stringify(input.credentials);
    const { ciphertext, iv, authTag } = this.encrypt(payload);
    const idHint = input.credentials.clientId.slice(-4);
    const now = new Date().toISOString();
    const id = cryptoRandomId();

    if (input.accountId) {
      this.sqlite.prepare("DELETE FROM platform_app_credentials WHERE account_id = ?").run(input.accountId);
      this.sqlite.prepare(
        `INSERT INTO platform_app_credentials
         (id, account_id, profile_id, platform, ciphertext, iv, auth_tag, id_hint, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.accountId, input.platform, ciphertext, iv, authTag, idHint, now);
    } else {
      this.sqlite.prepare(
        "DELETE FROM platform_app_credentials WHERE profile_id = ? AND platform = ? AND account_id IS NULL",
      ).run(input.profileId, input.platform);
      this.sqlite.prepare(
        `INSERT INTO platform_app_credentials
         (id, account_id, profile_id, platform, ciphertext, iv, auth_tag, id_hint, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.profileId, input.platform, ciphertext, iv, authTag, idHint, now);
    }
    return { idHint };
  }

  loadAppCredentials(accountId: string, profileId: string, platform: string): StoredAppCredentials | null {
    const accountRow = this.sqlite.prepare(
      "SELECT ciphertext, iv, auth_tag FROM platform_app_credentials WHERE account_id = ?",
    ).get(accountId) as { ciphertext: string; iv: string; auth_tag: string } | undefined;
    if (accountRow) {
      return JSON.parse(this.decrypt(accountRow.ciphertext, accountRow.iv, accountRow.auth_tag)) as StoredAppCredentials;
    }
    const profileRow = this.sqlite.prepare(
      "SELECT ciphertext, iv, auth_tag FROM platform_app_credentials WHERE profile_id = ? AND platform = ? AND account_id IS NULL",
    ).get(profileId, platform) as { ciphertext: string; iv: string; auth_tag: string } | undefined;
    if (!profileRow) return null;
    return JSON.parse(this.decrypt(profileRow.ciphertext, profileRow.iv, profileRow.auth_tag)) as StoredAppCredentials;
  }

  appCredentialsStatus(accountId: string, profileId: string, platform: string): { configured: boolean; idHint: string | null } {
    const accountRow = this.sqlite.prepare(
      "SELECT id_hint FROM platform_app_credentials WHERE account_id = ?",
    ).get(accountId) as { id_hint: string | null } | undefined;
    if (accountRow) return { configured: true, idHint: accountRow.id_hint };
    const profileRow = this.sqlite.prepare(
      "SELECT id_hint FROM platform_app_credentials WHERE profile_id = ? AND platform = ? AND account_id IS NULL",
    ).get(profileId, platform) as { id_hint: string | null } | undefined;
    if (profileRow) return { configured: true, idHint: profileRow.id_hint };
    return { configured: false, idHint: null };
  }

  deleteAppCredentials(accountId: string): void {
    this.sqlite.prepare("DELETE FROM platform_app_credentials WHERE account_id = ?").run(accountId);
  }

  /** Encrypt and store a generic app secret (e.g. telegram.botToken). Never logs plaintext. */
  storeSecret(key: string, value: string): void {
    const { ciphertext, iv, authTag } = this.encrypt(value);
    const now = new Date().toISOString();
    this.sqlite.prepare(
      `INSERT INTO app_secrets (key, ciphertext, iv, auth_tag, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         updated_at = excluded.updated_at`,
    ).run(key, ciphertext, iv, authTag, now);
  }

  loadSecret(key: string): string | null {
    const row = this.sqlite.prepare(
      "SELECT ciphertext, iv, auth_tag FROM app_secrets WHERE key = ?",
    ).get(key) as { ciphertext: string; iv: string; auth_tag: string } | undefined;
    if (!row) return null;
    return this.decrypt(row.ciphertext, row.iv, row.auth_tag);
  }

  deleteSecret(key: string): void {
    this.sqlite.prepare("DELETE FROM app_secrets WHERE key = ?").run(key);
  }

  hasSecret(key: string): boolean {
    const row = this.sqlite.prepare("SELECT 1 AS ok FROM app_secrets WHERE key = ?").get(key) as
      | { ok: number }
      | undefined;
    return Boolean(row);
  }

  private encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  decrypt(ciphertextB64: string, ivB64: string, authTagB64: string): string {
    const decipher = createDecipheriv(ALGO, this.getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  private getKey(): Buffer {
    if (this.key) return this.key;
    if (this.encryptionKeyBase64?.trim()) {
      const key = Buffer.from(this.encryptionKeyBase64.trim(), "base64");
      if (key.length !== KEY_BYTES) {
        throw new Error(`TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes`);
      }
      this.key = key;
      return key;
    }
    const keyPath = join(this.dataDir, "secrets", "token.key");
    if (existsSync(keyPath)) {
      this.key = readFileSync(keyPath);
      if (this.key.length !== KEY_BYTES) {
        throw new Error(`Token key file at ${keyPath} must be ${KEY_BYTES} bytes`);
      }
      return this.key;
    }
    mkdirSync(dirname(keyPath), { recursive: true });
    const generated = randomBytes(KEY_BYTES);
    writeFileSync(keyPath, generated, { flag: "wx" });
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // Windows may not support mode 0600; ignore.
    }
    this.key = generated;
    return generated;
  }
}

function cryptoRandomId(): string {
  return randomBytes(16).toString("hex");
}
