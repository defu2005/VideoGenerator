import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
