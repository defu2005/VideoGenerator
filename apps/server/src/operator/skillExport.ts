import { containsProtectedProject } from "@vg/shared";
import { parseSkillMarkdown, validateSkillMarkdown } from "./skills.js";

/** What is on disk for one skill folder. `symlink` means the folder or file is a link; it is never followed. */
export type RepoSkillFile = { content: string } | { symlink: true };

export type ActiveSkillVersion = { name: string; version: number; markdown: string };

export type SkillExportAction =
  | { kind: "create"; name: string; version: number; markdown: string }
  | { kind: "skip"; name: string; version: number }
  | { kind: "conflict"; name: string; version: number; diff: string }
  | { kind: "overwrite"; name: string; version: number; markdown: string; diff: string }
  | { kind: "invalid"; name: string; version: number; errors: string[] };

const NAME = /^video-[a-z0-9][a-z0-9-]{1,73}$/;

export function summarizeDiff(current: string, next: string): string {
  const a = current.split(/\r?\n/);
  const b = next.split(/\r?\n/);
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  return `file ${a.length} dòng, bản trong app ${b.length} dòng, khác từ dòng ${first + 1}`;
}

/**
 * Pure planner for `npm run export-skills`. Only active versions named `video-*` are exported.
 * Invalid markdown is reported and never written. A differing existing file is a `conflict`
 * unless `write` is set, in which case it is an `overwrite`. Nothing here deletes a file.
 */
// TASK-123: the Hermes sync sidecar reads the same exported files; keep paths stable.
// TASK-074b: the skill eval will gate which versions reach this planner.
export function planSkillExport(
  activeVersions: readonly ActiveSkillVersion[],
  repoFiles: ReadonlyMap<string, RepoSkillFile>,
  options: { toolNames: ReadonlySet<string>; write?: boolean },
): SkillExportAction[] {
  const latest = new Map<string, ActiveSkillVersion>();
  for (const item of activeVersions) {
    if (!item.name.startsWith("video-")) continue;
    const seen = latest.get(item.name);
    if (!seen || item.version > seen.version) latest.set(item.name, item);
  }
  const actions: SkillExportAction[] = [];
  for (const item of [...latest.values()].sort((x, y) => x.name.localeCompare(y.name))) {
    const errors = validateSkillMarkdown(item.markdown, options.toolNames);
    const parsed = parseSkillMarkdown(item.markdown);
    if (!NAME.test(item.name)) errors.push("Tên skill không hợp lệ.");
    if (parsed && parsed.name !== item.name) errors.push("Tên trong markdown khác tên phiên bản.");
    if (!parsed?.operator) errors.push("Thiếu operator: true.");
    if (containsProtectedProject(item.markdown)) errors.push("Chứa mã dự án được bảo vệ.");
    if (errors.length) {
      actions.push({ kind: "invalid", name: item.name, version: item.version, errors });
      continue;
    }
    const existing = repoFiles.get(item.name);
    if (!existing) {
      actions.push({ kind: "create", name: item.name, version: item.version, markdown: item.markdown });
    } else if ("symlink" in existing) {
      actions.push({ kind: "invalid", name: item.name, version: item.version, errors: ["Đường dẫn là symlink, không ghi."] });
    } else if (existing.content === item.markdown) {
      actions.push({ kind: "skip", name: item.name, version: item.version });
    } else if (options.write) {
      actions.push({ kind: "overwrite", name: item.name, version: item.version, markdown: item.markdown, diff: summarizeDiff(existing.content, item.markdown) });
    } else {
      actions.push({ kind: "conflict", name: item.name, version: item.version, diff: summarizeDiff(existing.content, item.markdown) });
    }
  }
  return actions;
}
