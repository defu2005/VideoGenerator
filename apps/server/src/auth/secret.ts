import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SECRET_FILE = "better-auth.secret";

/** Load BETTER_AUTH_SECRET, or create DATA_DIR/secrets/better-auth.secret. Never log the value. */
export function loadAuthSecret(dataDir: string, configured: string | undefined): string {
  const fromEnv = configured?.trim();
  if (fromEnv) return fromEnv;
  const path = join(dataDir, "secrets", SECRET_FILE);
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  }
  mkdirSync(dirname(path), { recursive: true });
  const secret = randomBytes(32).toString("base64");
  try {
    writeFileSync(path, secret, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
    throw error;
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may reject the Unix mode. The file is still only on this machine.
  }
  return secret;
}
