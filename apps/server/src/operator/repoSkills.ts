import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillMarkdown, validateSkillMarkdown, type OperatorSkill } from "./skills.js";

export type RepoSkill = OperatorSkill & { source: "repo"; path: string; markdown: string };

type CacheEntry = { mtimeMs: number; skill?: RepoSkill; errors?: string[] };

const cache = new Map<string, CacheEntry>();

export function loadRepoSkills(input: {
  root: string;
  toolNames: ReadonlySet<string>;
  builtinNames: ReadonlySet<string>;
  userNames?: ReadonlySet<string>;
}): { skills: RepoSkill[]; rejected: Array<{ path: string; errors: string[] }> } {
  const dir = join(input.root, ".agents", "skills");
  if (!existsSync(dir)) return { skills: [], rejected: [] };
  const skills: RepoSkill[] = [];
  const rejected: Array<{ path: string; errors: string[] }> = [];
  for (const folderName of readdirSync(dir)) {
    const folder = join(dir, folderName);
    const folderStat = lstatSync(folder);
    if (folderStat.isSymbolicLink() || !folderStat.isDirectory()) continue;
    const path = join(folder, "SKILL.md");
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.size > 64 * 1024) {
      rejected.push({ path, errors: ["File lớn hơn 64 KB."] });
      continue;
    }
    const mtimeMs = Math.trunc(stat.mtimeMs);
    const cached = cache.get(path);
    if (cached && cached.mtimeMs === mtimeMs) {
      if (cached.skill && !clash(cached.skill.name, input)) skills.push(cached.skill);
      else if (cached.errors) rejected.push({ path, errors: cached.errors });
      else if (cached.skill) {
        const errors = clashErrors(cached.skill.name, input);
        rejected.push({ path, errors });
        console.warn(`Repo skill bị từ chối: ${path}: ${errors.join("; ")}`);
      }
      continue;
    }
    const markdown = readFileSync(path, "utf8");
    const parsed = parseSkillMarkdown(markdown);
    if (!parsed?.operator) {
      cache.set(path, { mtimeMs });
      continue;
    }
    const errors = validateSkillMarkdown(markdown, input.toolNames);
    if (folderName !== parsed.name) errors.push("Tên thư mục khác name");
    errors.push(...clashErrors(parsed.name, input));
    if (errors.length > 0) {
      cache.set(path, { mtimeMs, errors });
      rejected.push({ path, errors });
      console.warn(`Repo skill bị từ chối: ${path}: ${errors.join("; ")}`);
      continue;
    }
    const risk = parsed.risk === "read" || parsed.risk === "safe" || parsed.risk === "confirm" ? parsed.risk : "confirm";
    const skill: RepoSkill = {
      source: "repo",
      path,
      markdown,
      area: parsed.area || "kenh",
      topic: parsed.name,
      name: parsed.name,
      description: parsed.description,
      triggers: parsed.triggers,
      antiTriggers: parsed.antiTriggers,
      tools: parsed.tools,
      risk,
      shortSteps: parsed.shortBody.split("\n").map((line) => line.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean),
      longNotes: [parsed.body],
    };
    cache.set(path, { mtimeMs, skill });
    skills.push(skill);
  }
  return { skills, rejected };
}

function clash(name: string, input: { builtinNames: ReadonlySet<string>; userNames?: ReadonlySet<string> }): boolean {
  return input.builtinNames.has(name) || Boolean(input.userNames?.has(name));
}

function clashErrors(name: string, input: { builtinNames: ReadonlySet<string>; userNames?: ReadonlySet<string> }): string[] {
  const errors: string[] = [];
  if (input.builtinNames.has(name)) errors.push("Trùng tên kỹ năng có sẵn");
  if (input.userNames?.has(name)) errors.push("Trùng tên kỹ năng người dùng");
  return errors;
}
