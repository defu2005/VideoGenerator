/**
 * Xuất skill `video-*` đang dùng trong app ra `.agents/skills/<tên>/SKILL.md` để mọi agent dùng chung.
 *   npm run export-skills            → chạy thử, chỉ in kế hoạch
 *   npm run export-skills -- --write → ghi file mới; ghi đè file khác nội dung
 * Không bao giờ xoá file và không đi theo symlink.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../db/client.js";
import { parseConfig } from "../lib/config.js";
import { ASSISTANT_TOOLS } from "../assistant/tools.js";
import { repoRoot } from "../operator/workspace.js";
import { listSkillVersions } from "../operator/skillVersions.js";
import { planSkillExport, type RepoSkillFile } from "../operator/skillExport.js";

const write = process.argv.includes("--write");
const root = repoRoot();
const config = parseConfig();
const { sqlite } = openDatabase(config.DATABASE_PATH);
try {
  const active = listSkillVersions(sqlite, true).map(({ name, version, markdown }) => ({ name, version, markdown }));
  const skillsDir = join(root, ".agents", "skills");
  const files = new Map<string, RepoSkillFile>();
  for (const { name } of active) {
    const folder = join(skillsDir, name);
    const file = join(folder, "SKILL.md");
    if (!existsSync(folder)) continue;
    if (lstatSync(folder).isSymbolicLink()) { files.set(name, { symlink: true }); continue; }
    if (!existsSync(file)) continue;
    if (lstatSync(file).isSymbolicLink()) { files.set(name, { symlink: true }); continue; }
    files.set(name, { content: readFileSync(file, "utf8") });
  }
  const actions = planSkillExport(active, files, { toolNames: new Set(Object.keys(ASSISTANT_TOOLS)), write });
  if (actions.length === 0) console.log("Không có skill video-* đang dùng để xuất.");
  for (const action of actions) {
    const label = `${action.name} v${action.version}`;
    if (action.kind === "skip") console.log(`= ${label}: giống file trong repo.`);
    else if (action.kind === "invalid") console.log(`! ${label}: không xuất (${action.errors.join("; ")})`);
    else if (action.kind === "conflict") console.log(`~ ${label}: khác file trong repo (${action.diff}). Thêm --write để ghi đè.`);
    else {
      const folder = join(skillsDir, action.name);
      console.log(`${action.kind === "create" ? "+" : "*"} ${label}: ${write ? "ghi" : "sẽ ghi"} ${join(folder, "SKILL.md")}`);
      if (write) {
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "SKILL.md"), action.markdown, "utf8");
      }
    }
  }
  if (!write) console.log("Chạy thử: chưa ghi gì. Thêm --write để ghi.");
} catch (error) {
  console.error(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
