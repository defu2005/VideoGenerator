import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { PasswordResetError, resetPassword } from "../src/auth/passwordReset.js";
import { openDatabase } from "../src/db/client.js";

const root = mkdtempSync(join(tmpdir(), "vg-reset-"));
const config = parseConfig({
  DATA_DIR: root,
  DATABASE_PATH: join(root, "app.db"),
  PORT: "3001",
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
  CORS_ORIGIN: "http://localhost:5173",
  WEB_BASE_URL: "http://localhost:5180",
  WORKER_ENABLED: "false",
  TTS_PROVIDER: "mock",
  IMAGE_PROVIDERS: "mock",
  LLM_ENABLE_MOCK: "true",
});
const app = buildApp({ config });
let sqlite: ReturnType<typeof openDatabase>["sqlite"];

afterAll(async () => {
  sqlite?.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const email = "owner@example.com";

async function login(password: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: "http://localhost:5180" },
    payload: { email, password },
  });
}

describe("resetPassword", () => {
  it("refuses when there is no owner yet", async () => {
    await app.ready();
    sqlite = openDatabase(config.DATABASE_PATH).sqlite;
    await expect(resetPassword(sqlite, { newPassword: "new-password-1" })).rejects.toBeInstanceOf(PasswordResetError);
  });

  it("resets the owner's password and revokes sessions", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/setup/owner",
      payload: { name: "Owner", email, password: "old-password-1" },
    });
    expect(created.statusCode).toBe(201);
    expect((await login("old-password-1")).statusCode).toBe(200);

    await expect(resetPassword(sqlite, { newPassword: "short" })).rejects.toBeInstanceOf(PasswordResetError);
    const result = await resetPassword(sqlite, { newPassword: "new-password-1" });
    expect(result.email).toBe(email);
    expect(result.sessionsRevoked).toBeGreaterThan(0);

    expect((await login("old-password-1")).statusCode).toBe(401);
    expect((await login("new-password-1")).statusCode).toBe(200);
  });

  it("targets another account by email and rejects unknown emails", async () => {
    await expect(resetPassword(sqlite, { newPassword: "new-password-2", email: "nobody@example.com" }))
      .rejects.toBeInstanceOf(PasswordResetError);
    const result = await resetPassword(sqlite, { newPassword: "new-password-2", email: "OWNER@example.com" });
    expect(result.email).toBe(email);
  });
});
