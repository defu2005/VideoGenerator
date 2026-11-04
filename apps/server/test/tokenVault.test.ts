import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { TokenVault } from "../src/publishing/tokenVault.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-vault-"));
  roots.push(root);
  const database = openDatabase(join(root, "app.db"));
  migrateDatabase(database.db, undefined, database.sqlite);
  const sqlite = database.sqlite;
  const profileId = "11111111-1111-4111-8111-111111111111";
  const accountId = "22222222-2222-4222-8222-222222222222";
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, avatar_path, color, archived_at, created_at, updated_at)
     VALUES (?, 'Vault', '', '', 'vi', ?, NULL, ?, NULL, NULL, '#3B82F6', NULL, ?, ?)`,
  ).run(
    profileId,
    JSON.stringify({ platform: "youtube" }),
    JSON.stringify({ platformPack: "auto", customRules: [] }),
    now,
    now,
  );
  sqlite.prepare(
    `INSERT INTO platform_accounts (id, profile_id, platform, display_name, handle, format, enabled, connection, connection_error, publish_settings, created_at, updated_at)
     VALUES (?, ?, 'mock', 'Mock', NULL, 'landscape', 1, 'NOT_CONNECTED', NULL, ?, ?, ?)`,
  ).run(accountId, profileId, JSON.stringify({ visibility: "public", autoPublish: false }), now, now);
  return { root, sqlite, accountId, profileId, close: () => database.sqlite.close() };
}

describe("TokenVault", () => {
  it("round-trips tokens and creates a key file once", () => {
    const { root, sqlite, accountId, close } = setup();
    try {
      const vault = new TokenVault(sqlite, root);
      const tokens = {
        accessToken: "access-secret-value",
        refreshToken: "refresh-secret-value",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: ["mock.upload"],
      };
      vault.storeTokens(accountId, tokens);
      const loaded = vault.loadTokens(accountId);
      expect(loaded?.accessToken).toBe(tokens.accessToken);
      expect(loaded?.refreshToken).toBe(tokens.refreshToken);
      expect(existsSync(join(root, "secrets", "token.key"))).toBe(true);

      const vault2 = new TokenVault(sqlite, root);
      expect(vault2.loadTokens(accountId)?.accessToken).toBe(tokens.accessToken);
    } finally {
      close();
    }
  });

  it("rejects tampered ciphertext", () => {
    const { root, sqlite, accountId, close } = setup();
    try {
      const vault = new TokenVault(sqlite, root);
      vault.storeTokens(accountId, {
        accessToken: "good",
        scopes: [],
      });
      sqlite.prepare(
        "UPDATE platform_credentials SET ciphertext = ? WHERE account_id = ?",
      ).run(Buffer.from("tampered").toString("base64"), accountId);
      expect(() => vault.loadTokens(accountId)).toThrow();
    } finally {
      close();
    }
  });

  it("uses TOKEN_ENCRYPTION_KEY from env-style base64", () => {
    const { root, sqlite, accountId, close } = setup();
    try {
      const key = Buffer.alloc(32, 7).toString("base64");
      const vault = new TokenVault(sqlite, root, key);
      vault.storeTokens(accountId, { accessToken: "keyed", scopes: ["a"] });
      const other = new TokenVault(sqlite, root, key);
      expect(other.loadTokens(accountId)?.accessToken).toBe("keyed");
    } finally {
      close();
    }
  });
});
