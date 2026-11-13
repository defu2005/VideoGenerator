import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import type { VideoAgentAuth } from "./instance.js";

export const LOCAL_SERVICE_KEY_NAME = "local-services";

export function localServiceKeyPath(dataDir: string): string {
  return join(dataDir, "secrets", `${LOCAL_SERVICE_KEY_NAME}.key`);
}

export function readLocalServiceKey(dataDir: string): string | null {
  const path = localServiceKeyPath(dataDir);
  if (!existsSync(path)) return null;
  const key = readFileSync(path, "utf8").trim();
  return key || null;
}

function writeKeyFile(dataDir: string, key: string): void {
  const path = localServiceKeyPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key, { encoding: "utf8", mode: 0o600, flag: "w" });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may reject the Unix mode.
  }
}

export function findOwnerId(sqlite: Database.Database): string | null {
  const owner = sqlite.prepare(
    "SELECT id FROM user WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1",
  ).get() as { id: string } | undefined;
  if (owner) return owner.id;
  const first = sqlite.prepare(
    "SELECT id FROM user ORDER BY created_at ASC LIMIT 1",
  ).get() as { id: string } | undefined;
  if (!first) return null;
  sqlite.prepare("UPDATE user SET role = 'owner' WHERE id = ?").run(first.id);
  return first.id;
}

export async function ensureLocalServiceKey(input: {
  auth: VideoAgentAuth;
  sqlite: Database.Database;
  dataDir: string;
  ownerId?: string;
}): Promise<void> {
  const ownerId = input.ownerId ?? findOwnerId(input.sqlite);
  if (!ownerId) return;
  const existing = readLocalServiceKey(input.dataDir);
  if (existing) {
    const verified = await input.auth.api.verifyApiKey({ body: { key: existing } });
    if (verified.valid && verified.key?.referenceId === ownerId && verified.key.enabled !== false) return;
  }
  const created = await input.auth.api.createApiKey({
    body: {
      name: LOCAL_SERVICE_KEY_NAME,
      userId: ownerId,
    },
  });
  if (!created.key) throw new Error("Local service key was not created");
  writeKeyFile(input.dataDir, created.key);
}
