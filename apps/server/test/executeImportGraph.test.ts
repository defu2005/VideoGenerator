import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

const FORBIDDEN = [/(^|\/)db\//, /providers\/llm/, /(^|\/)vault/, /better-sqlite3/, /(^|\/)auth\//, /drizzle/];

/** Value imports only. `import type` never reaches runtime, so it is not an edge. */
function valueImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  const pattern = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (const match of text.matchAll(pattern)) {
    if (match[2]) continue;
    const spec = match[4] ?? match[5];
    if (spec) found.push(spec);
  }
  return found;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  return null;
}

describe("execute part of the render", () => {
  it("never reaches the database, LLM providers, the vault or auth", () => {
    const entry = join(SRC, "render", "executeRender.ts");
    const seen = new Set<string>();
    const stack = [entry];
    const bad: string[] = [];
    while (stack.length) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of valueImports(file)) {
        if (FORBIDDEN.some((rule) => rule.test(spec))) bad.push(`${file.replace(SRC, "src")} -> ${spec}`);
        const next = resolveLocal(file, spec);
        if (!next) continue;
        if (FORBIDDEN.some((rule) => rule.test(next.replace(SRC, "")))) bad.push(`${file.replace(SRC, "src")} -> ${next.replace(SRC, "src")}`);
        stack.push(next);
      }
    }
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(3);
  });

  it("the type-only import filter ignores import type", () => {
    const entry = join(SRC, "render", "types.ts");
    expect(valueImports(entry).filter((spec) => spec.startsWith("."))).toEqual([]);
  });
});
