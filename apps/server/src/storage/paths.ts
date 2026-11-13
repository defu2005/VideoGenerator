import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** localPath is relative to the project directory, for example "visuals/<sha>.jpg". */
export function resolveAssetPath(dataDir: string, projectId: string, localPath: string): string {
  const root = projectDir(dataDir, projectId);
  const normalized = localPath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^[/\\]+/, "");
  const resolved = isAbsolute(localPath) ? resolve(localPath) : resolve(root, normalized);
  const fromRoot = relative(root, resolved);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Asset path resolves outside the project directory");
  }
  return resolved;
}

export function projectDir(dataDir: string, id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new Error("Invalid project id: expected a UUID");
  }

  const root = resolve(dataDir);
  const directory = resolve(root, "projects", id);
  const pathFromRoot = relative(root, directory);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Project directory resolves outside DATA_DIR");
  }

  return directory;
}

export function createProjectDir(dataDir: string, id: string): string {
  const directory = projectDir(dataDir, id);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function removeProjectDir(dataDir: string, id: string): void {
  rmSync(projectDir(dataDir, id), { recursive: true, force: true });
}
