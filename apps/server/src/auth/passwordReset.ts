import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { hashPassword } from "better-auth/crypto";

export type ResetResult = { userId: string; email: string; sessionsRevoked: number };

export class PasswordResetError extends Error {}

/**
 * Local recovery for a forgotten password (no email sending in this app).
 * Only reachable from a shell on the machine that holds the DB, never over HTTP.
 * Default target is the instance owner. Every session of that user is revoked.
 */
export async function resetPassword(
  sqlite: Database.Database,
  input: { newPassword: string; email?: string },
): Promise<ResetResult> {
  if (input.newPassword.length < 8 || input.newPassword.length > 128) {
    throw new PasswordResetError("Mật khẩu phải dài 8–128 ký tự.");
  }
  const target = input.email
    ? sqlite.prepare("SELECT id, email FROM user WHERE lower(email) = lower(?)").get(input.email.trim())
    : sqlite.prepare("SELECT id, email FROM user WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1").get();
  const found = target as { id: string; email: string } | undefined;
  if (!found) {
    throw new PasswordResetError(input.email
      ? "Không có tài khoản với email này."
      : "Chưa có chủ sở hữu. Mở trang /setup để tạo.");
  }
  const hash = await hashPassword(input.newPassword);
  const now = Date.now();
  const run = sqlite.transaction(() => {
    const updated = sqlite.prepare(
      "UPDATE account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = 'credential'",
    ).run(hash, now, found.id);
    if (updated.changes === 0) {
      sqlite.prepare(
        "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)",
      ).run(randomUUID(), found.id, found.id, hash, now, now);
    }
    return sqlite.prepare("DELETE FROM session WHERE user_id = ?").run(found.id).changes;
  });
  const sessionsRevoked = run();
  return { userId: found.id, email: found.email, sessionsRevoked };
}
