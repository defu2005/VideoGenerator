import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

/** Version of the nearest package.json (the server package; the root has no version field). Control plane and worker must match. */
export function readAppVersion(): string {
  if (cached) return cached;
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const file = join(directory, "package.json");
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: string; workspaces?: unknown };
        if (typeof parsed.version === "string") {
          cached = parsed.version;
          return cached;
        }
      } catch {
        // keep climbing
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  cached = "0.0.0";
  return cached;
}
