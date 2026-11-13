import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function providerIntelExportRoot(dataDir: string): string {
  if (process.env.VITEST) return join(dataDir, "provider-intelligence");
  let directory = resolve(process.cwd());
  while (true) {
    const packagePath = join(directory, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { workspaces?: unknown };
      if (packageJson.workspaces !== undefined) return join(directory, "provider-intelligence");
    }
    const parent = dirname(directory);
    if (parent === directory) return join(dataDir, "provider-intelligence");
    directory = parent;
  }
}
