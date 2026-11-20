import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";
import { expect, it } from "vitest";
import ts from "typescript";
import { PROJECT_CONTEXT_READS } from "../src/node/projectContext.js";
import { PROJECT_TABLES } from "../src/pipeline/dataContract.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(path, entry.name))
    : entry.name.endsWith(".ts") ? [readFileSync(join(path, entry.name), "utf8")] : []);
}

it("requires workspace reads in executors and their context readers to be packed or handled by an explicit RPC", () => {
  const h = createPipelineHarness();
  try {
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const readers = sources(join(root, "stages"));
    for (const file of ["guidelines/settings.ts", "providers/llm/settings.ts", "providers/tts/registry.ts", "style/service.ts"]) readers.push(readFileSync(join(root, file), "utf8"));
    const knowledgeText = readFileSync(join(root, "knowledge/service.ts"), "utf8"), knowledgeFile = ts.createSourceFile("knowledge.ts", knowledgeText, ts.ScriptTarget.Latest, true);
    for (const statement of knowledgeFile.statements) if (ts.isClassDeclaration(statement) && statement.name?.text === "KnowledgeService") {
      for (const method of statement.members) if (ts.isMethodDeclaration(method) && ["get", "list", "value", "rows", "entryId", "recordProjectReads"].includes(method.name.getText(knowledgeFile))) readers.push(method.getText(knowledgeFile));
    }
    // These modules also contain admin/control operations. Only the imported prompt/repair readers run in executors.
    for (const [file, functions] of [["services/profileService.ts", ["getProfilePromptContext"]], ["operator/qualityGates.ts", ["readScriptRepairHint"]]] as const) {
      const text = readFileSync(join(root, file), "utf8"), parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      for (const node of parsed.statements) if (ts.isFunctionDeclaration(node) && functions.some((name) => name === node.name?.text)) readers.push(node.getText(parsed));
    }
    const workspaceTables = (h.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{ name: string }>)
      .filter(({ name }) => h.sqlite.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name='workspace_id'").get(name)).map(({ name }) => name);
    const packed = new Set([...Object.keys(PROJECT_CONTEXT_READS), ...PROJECT_TABLES.filter(({ owner }) => owner !== "control").map(({ table }) => getTableName(table))]);
    const gaps = (texts: string[]) => [...new Set(texts.flatMap((text) => [...text.matchAll(/\b(?:FROM|JOIN)\s+["`]?([a-z_][a-z_0-9]*)/gi)].map((match) => match[1]!.toLowerCase())))]
      .filter((table) => workspaceTables.includes(table) && !packed.has(table));
    expect(gaps(readers)).toEqual([]);
    // A new workspace read must trip the contract instead of silently inheriting the node's unrelated defaults.
    expect(gaps(["SELECT spec FROM operator_goals WHERE workspace_id=?"])).toEqual(["operator_goals"]);
  } finally { h.close(); }
});
