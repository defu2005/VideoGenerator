// Online backup of the product SQLite DB (safe while the server runs).
// Usage (from the product worktree): node deploy/product/backup-db.mjs <dataDir> <backupDir>
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [dataDir, backupDir] = process.argv.slice(2);
if (!dataDir || !backupDir) {
  console.error("usage: node deploy/product/backup-db.mjs <dataDir> <backupDir>");
  process.exit(2);
}
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(backupDir, `app-${stamp}.db`);
const db = new Database(join(dataDir, "app.db"), { readonly: true, fileMustExist: true });
await db.backup(target);
db.close();
const check = new Database(target, { readonly: true });
const result = check.pragma("quick_check", { simple: true });
check.close();
if (result !== "ok") {
  console.error(`backup written to ${target} but quick_check said: ${result}`);
  process.exit(1);
}
console.log(target);
