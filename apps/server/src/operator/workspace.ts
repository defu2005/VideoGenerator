import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OperatorDuty } from "./extensions.js";
import { renderHandbook, renderSnapshot, type HandbookSnapshot, type HandbookTool } from "./handbook.js";
import type { RepoSkill } from "./repoSkills.js";
import { OPERATOR_SKILLS, renderSkillMarkdown, skillShortBody, type OperatorSkill } from "./skills.js";

export function repoRoot(): string {
  return fileURLToPath(new URL("../../../../", import.meta.url));
}

export function findGitRoot(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Cursor CLI treats the git root as the project and then ignores a nested
 * `.cursor/mcp.json`. Keep this folder outside any work tree.
 */
export function operatorDir(dataDir: string): string {
  const preferred = join(dataDir, "operator");
  const gitRoot = findGitRoot(preferred);
  if (!gitRoot) return preferred;
  return join(dirname(gitRoot), ".video-agent-operator");
}

/** Same slug the CLI uses for `~/.cursor/projects/<slug>`. */
export function cursorProjectSlug(workspace: string): string {
  return workspace.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

/** Id stored in `mcp-approvals.json`. `--approve-mcps` is not read by CLI 2026.11.05. */
export function mcpApprovalId(workspace: string, serverName: string, server: unknown): string {
  const payload = JSON.stringify({ path: workspace, server });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `${serverName}-${hash}`;
}

/**
 * Project `.cursor/cli.json` for cursor-agent 2026.11.05.
 * That file only accepts `permissions`. `version`, `approvalMode` and
 * `sandbox` belong to the user config and make this file fail validation.
 * Deny is checked before allow, so `Write(**)` would also block notes/.
 * Shell(*) is denied here. Writes outside notes/ are reverted by the
 * server after each run (see guardWorkspace).
 */
export function cliConfig(): Record<string, unknown> {
  return {
    permissions: {
      allow: [
        "Read(**)",
        "Write(notes/**)",
        "Mcp(video-agent:*)",
      ],
      deny: [
        "Shell(*)",
      ],
    },
  };
}

export function mcpConfig(input: { apiUrl: string; mcpEntry: string; dataDir: string }): Record<string, unknown> {
  const dataDir = isAbsolute(input.dataDir) ? input.dataDir : resolve(input.dataDir);
  return {
    mcpServers: {
      "video-agent": {
        command: process.execPath,
        args: [input.mcpEntry],
        env: {
          VG_API_URL: input.apiUrl,
          VG_TOOL_SOURCE: "operator",
          VG_OPERATOR_MANAGED: "1",
          DATA_DIR: dataDir,
        },
      },
    },
  };
}

export function writeOperatorWorkspace(input: {
  dataDir: string;
  apiUrl: string;
  tools: HandbookTool[];
  duties: OperatorDuty[];
  extraSkills?: OperatorSkill[];
  repoSkills?: RepoSkill[];
  snapshot: HandbookSnapshot;
  snapshotMaxChars: number;
  standingOrdersMarkdown: string;
}): { dir: string; handbook: string } {
  const dir = operatorDir(input.dataDir);
  migrateLegacyOperator(input.dataDir, dir);
  mkdirSync(join(dir, ".cursor"), { recursive: true });
  mkdirSync(join(dir, "notes", "skill-proposals"), { recursive: true });
  mkdirSync(join(dir, "skills", "user"), { recursive: true });
  for (const skill of OPERATOR_SKILLS) {
    const path = join(dir, "skills", skill.area, `${skill.topic}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderSkillMarkdown(skill), "utf8");
  }
  for (const skill of input.repoSkills ?? []) {
    const path = join(dir, "skills", skill.area, `${skill.name}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, skill.markdown, "utf8");
  }
  const mcpEntry = join(repoRoot(), "apps", "mcp", "dist", "index.js");
  const mcp = mcpConfig({ apiUrl: input.apiUrl, mcpEntry, dataDir: input.dataDir });
  writeFileSync(join(dir, ".cursor", "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`, "utf8");
  const parsed = JSON.parse(JSON.stringify(mcp)) as { mcpServers: Record<string, unknown> };
  const server = parsed.mcpServers["video-agent"];
  if (server) writeMcpApproval(dir, "video-agent", server);
  writeFileSync(join(dir, ".cursor", "cli.json"), `${JSON.stringify(cliConfig(), null, 2)}\n`, "utf8");
  const handbook = renderHandbook({
    tools: input.tools,
    skills: [...OPERATOR_SKILLS, ...(input.repoSkills ?? []), ...(input.extraSkills ?? [])],
    duties: input.duties,
    snapshot: renderSnapshot(input.snapshot, input.snapshotMaxChars),
  });
  writeFileSync(join(dir, "AGENTS.md"), handbook, "utf8");
  writeFileSync(join(dir, "notes", "standing-orders.md"), input.standingOrdersMarkdown, "utf8");
  const journal = join(dir, "notes", "journal.md");
  if (!existsSync(journal)) {
    writeFileSync(journal, "# Nhật ký quyết định\n\n", "utf8");
  }
  const lessons = join(dir, "notes", "lessons.md");
  if (!existsSync(lessons)) {
    writeFileSync(lessons, "# Bài học\n\n", "utf8");
  }
  return { dir, handbook };
}

function migrateLegacyOperator(dataDir: string, dest: string): void {
  const legacy = join(dataDir, "operator");
  if (resolve(legacy) === resolve(dest)) return;
  if (!existsSync(join(legacy, "notes"))) return;
  if (existsSync(join(dest, "notes"))) return;
  mkdirSync(dest, { recursive: true });
  cpSync(join(legacy, "notes"), join(dest, "notes"), { recursive: true });
  const skills = join(legacy, "skills", "user");
  if (existsSync(skills)) {
    mkdirSync(join(dest, "skills"), { recursive: true });
    cpSync(skills, join(dest, "skills", "user"), { recursive: true });
  }
}

function writeMcpApproval(workspace: string, serverName: string, server: unknown): void {
  if (process.env.VITEST) return;
  const dir = join(homedir(), ".cursor", "projects", cursorProjectSlug(workspace));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "mcp-approvals.json");
  const id = mcpApprovalId(workspace, serverName, server);
  let current: string[] = [];
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(parsed)) current = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      current = [];
    }
  }
  if (!current.includes(id)) current.push(id);
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

export function skillBodiesForRouting(): Array<{
  id: string;
  name: string;
  description: string;
  body: string;
  shortBody: string;
  triggers: string[];
  antiTriggers: string[];
  area: string;
  tools: string[];
}> {
  return OPERATOR_SKILLS.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description,
    body: skill.longNotes.join(" "),
    shortBody: skillShortBody(skill),
    triggers: skill.triggers,
    antiTriggers: skill.antiTriggers,
    area: areaLabel(skill.area),
    tools: skill.tools,
  }));
}

function areaLabel(folder: string): string {
  const map: Record<string, string> = {
    "dang-bai": "Đăng bài",
    "tro-ly": "Trợ lý",
    "mo-hinh-ai": "Mô hình AI",
    "binh-luan": "Bình luận",
    "tro-giup": "Trợ giúp",
    kenh: "Kênh",
  };
  return map[folder] ?? folder;
}

export function readNote(dataDir: string, name: string): string {
  const path = join(operatorDir(dataDir), "notes", name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}
