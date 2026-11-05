import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OperatorDuty } from "./extensions.js";
import { renderHandbook, renderSnapshot, type HandbookSnapshot, type HandbookTool } from "./handbook.js";
import { OPERATOR_SKILLS, renderSkillMarkdown, skillShortBody, type OperatorSkill } from "./skills.js";

export function repoRoot(): string {
  return fileURLToPath(new URL("../../../../", import.meta.url));
}

export function operatorDir(dataDir: string): string {
  return join(dataDir, "operator");
}

/**
 * Permission file for cursor-agent 2026.11.05.
 * Deny is checked before allow, so Write(**) would also block notes/.
 * Shell(*) is denied here. Writes outside notes/ are reverted by the
 * server after each run (see guardWorkspace).
 */
export function cliConfig(): Record<string, unknown> {
  return {
    version: 1,
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
    approvalMode: "allowlist",
    sandbox: {
      mode: "disabled",
      readBoundary: "workspace",
    },
  };
}

export function mcpConfig(input: { apiUrl: string; mcpEntry: string }): Record<string, unknown> {
  return {
    mcpServers: {
      "video-agent": {
        command: process.execPath,
        args: [input.mcpEntry],
        env: {
          VG_API_URL: input.apiUrl,
          VG_TOOL_SOURCE: "operator",
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
  snapshot: HandbookSnapshot;
  snapshotMaxChars: number;
  standingOrdersMarkdown: string;
}): { dir: string; handbook: string } {
  const dir = operatorDir(input.dataDir);
  mkdirSync(join(dir, ".cursor"), { recursive: true });
  mkdirSync(join(dir, "notes", "skill-proposals"), { recursive: true });
  mkdirSync(join(dir, "skills", "user"), { recursive: true });
  for (const skill of OPERATOR_SKILLS) {
    const path = join(dir, "skills", skill.area, `${skill.topic}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderSkillMarkdown(skill), "utf8");
  }
  const mcpEntry = join(repoRoot(), "apps", "mcp", "dist", "index.js");
  writeFileSync(join(dir, ".cursor", "mcp.json"), `${JSON.stringify(mcpConfig({
    apiUrl: input.apiUrl,
    mcpEntry,
  }), null, 2)}\n`, "utf8");
  writeFileSync(join(dir, ".cursor", "cli.json"), `${JSON.stringify(cliConfig(), null, 2)}\n`, "utf8");
  const handbook = renderHandbook({
    tools: input.tools,
    skills: [...OPERATOR_SKILLS, ...(input.extraSkills ?? [])],
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
  };
  return map[folder] ?? folder;
}

export function readNote(dataDir: string, name: string): string {
  const path = join(operatorDir(dataDir), "notes", name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}
