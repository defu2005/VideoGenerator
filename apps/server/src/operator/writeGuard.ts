import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

function walkFiles(root: string, dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).replaceAll("\\", "/");
    if (rel === "notes" || rel.startsWith("notes/")) continue;
    if (entry.isDirectory()) walkFiles(root, abs, out);
    else if (entry.isFile()) out.push(rel);
  }
}

export function snapshotOutsideNotes(root: string): Map<string, Buffer> {
  const files: string[] = [];
  walkFiles(root, root, files);
  const snap = new Map<string, Buffer>();
  for (const rel of files) snap.set(rel, readFileSync(join(root, rel)));
  return snap;
}

/** Restore or delete anything outside notes/. Returns the relative paths that changed. */
export function restoreOutsideNotes(root: string, before: Map<string, Buffer>): string[] {
  const currentFiles: string[] = [];
  walkFiles(root, root, currentFiles);
  const changed: string[] = [];
  for (const rel of currentFiles) {
    const abs = join(root, rel);
    const previous = before.get(rel);
    const now = readFileSync(abs);
    if (!previous || !now.equals(previous)) {
      changed.push(rel);
      if (previous) writeFileSync(abs, previous);
      else rmSync(abs, { force: true });
    }
  }
  for (const rel of before.keys()) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, before.get(rel)!);
      changed.push(rel);
    }
  }
  return [...new Set(changed)];
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
