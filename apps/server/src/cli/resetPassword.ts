/**
 * Đặt lại mật khẩu khi quên (app không gửi email).
 *   npm run reset-password -w @vg/server            → chủ sở hữu
 *   npm run reset-password -w @vg/server -- a@b.com → tài khoản có email đó
 * Chỉ chạy được trên máy giữ file DB. Mật khẩu nhập ẩn, không ghi log.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { openDatabase } from "../db/client.js";
import { parseConfig } from "../lib/config.js";
import { PasswordResetError, resetPassword } from "../auth/passwordReset.js";

function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const email = process.argv[2]?.trim() || undefined;
const config = parseConfig();
const { sqlite } = openDatabase(config.DATABASE_PATH);
try {
  const first = await askHidden("Mật khẩu mới (ít nhất 8 ký tự): ");
  const second = await askHidden("Nhập lại mật khẩu mới: ");
  if (first !== second) throw new PasswordResetError("Hai lần nhập không khớp.");
  const result = await resetPassword(sqlite, { newPassword: first, ...(email ? { email } : {}) });
  console.log(`Đã đổi mật khẩu cho ${result.email}. Đã đăng xuất ${result.sessionsRevoked} phiên. Đăng nhập lại bằng mật khẩu mới.`);
} catch (error) {
  console.error(error instanceof PasswordResetError ? error.message : `Lỗi: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
