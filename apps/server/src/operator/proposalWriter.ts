import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// TASK-074c-4a: the narrow writer for docs/proposals/. It writes only IMP-<n>.md drafts into an injected root,
// never overwrites, and refuses symlinks and junctions. It is not wired to any caller yet, and it is not part of
// writeGuard.ts, which only snapshots and restores.
// TASK-074c-3c-1: checkProposalTarget runs the same name, root and target checks without writing, so a caller can
// refuse before it spends anything. writeProposalDraft keeps the wx flag as the backstop.

const NAME_PATTERN = /^IMP-[1-9]\d{0,8}\.md$/;
export const MAX_DRAFT_BYTES = 100_000;

type Refusal = "bad_name" | "bad_root" | "unsafe_target" | "exists" | "bad_content";
export type ProposalDraftResult =
  | { status: "written"; path: string }
  | { status: "refused"; reason: Refusal };
export type ProposalTargetResult =
  | { status: "free"; target: string }
  | { status: "refused"; reason: Refusal };

const refused = (reason: Refusal): { status: "refused"; reason: Refusal } => ({ status: "refused", reason });

export function checkProposalTarget(rootInput: string, fileName: string): ProposalTargetResult {
  if (typeof fileName !== "string" || !NAME_PATTERN.test(fileName)) return refused("bad_name");

  // The root must be absolute. Its real path (every ancestor resolved, not only the last component) must equal its normalized path.
  if (typeof rootInput !== "string" || !isAbsolute(rootInput)) return refused("bad_root");
  const rootDir = resolve(rootInput);
  let rootStat;
  let rootReal: string;
  try {
    rootStat = lstatSync(rootDir);
    rootReal = realpathSync.native(rootDir);
  } catch {
    return refused("bad_root");
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return refused("bad_root");
  const sameLocation = process.platform === "win32" ? rootReal.toLowerCase() === rootDir.toLowerCase() : rootReal === rootDir;
  if (!sameLocation) return refused("bad_root");

  const target = join(rootDir, fileName);
  // The name pattern already rules out separators; this is a second layer that rejects any escape from the root.
  const rel = relative(rootDir, target);
  if (rel !== fileName || isAbsolute(rel) || rel.startsWith("..")) return refused("bad_name");

  let existing;
  try {
    existing = lstatSync(target);
  } catch {
    existing = undefined;
  }
  if (existing) return refused(existing.isSymbolicLink() ? "unsafe_target" : "exists");
  return { status: "free", target };
}

export function writeProposalDraft(rootInput: string, fileName: string, content: string): ProposalDraftResult {
  if (typeof fileName !== "string" || !NAME_PATTERN.test(fileName)) return refused("bad_name");
  if (typeof content !== "string" || content.trim().length === 0 || Buffer.byteLength(content, "utf8") > MAX_DRAFT_BYTES) {
    return refused("bad_content");
  }

  const checked = checkProposalTarget(rootInput, fileName);
  if (checked.status === "refused") return checked;

  try {
    writeFileSync(checked.target, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return refused("exists");
    throw error;
  }
  return { status: "written", path: checked.target };
}
