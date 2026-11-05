import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type DetectedCursorCli = {
  indexJs: string;
  nodeExe: string;
  version: string;
};

/** Newest installed cursor-agent build. Does not spawn the CLI. */
export function detectCursorCli(env: NodeJS.ProcessEnv = process.env): DetectedCursorCli | null {
  const local = env.LOCALAPPDATA;
  if (!local) return null;
  const root = join(local, "cursor-agent", "versions");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}\.\d{2}\.\d{2}-/.test(entry.name) && !entry.name.includes(".previous"))
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(root, name, "index.js")) && existsSync(join(root, name, "node.exe")))
    .sort();
  const newest = dirs.at(-1);
  if (!newest) return null;
  return {
    indexJs: join(root, newest, "index.js"),
    nodeExe: join(root, newest, "node.exe"),
    version: newest,
  };
}

/**
 * The installed CLI (2026.11.05) has no per-run MCP tool filter flag.
 * Routing only changes the handbook and the files the operator reads.
 */
export const MCP_TOOL_FILTER_PER_RUN = false;

export function cursorLaunch(input: {
  detected: DetectedCursorCli | null;
  cursorPath: string;
}): { command: string; indexArg: string | null; version: string | null } | null {
  const override = input.cursorPath.trim();
  if (override) {
    if (override.toLowerCase().endsWith("index.js")) {
      const node = input.detected?.nodeExe ?? process.execPath;
      return { command: node, indexArg: override, version: input.detected?.version ?? null };
    }
    return { command: override, indexArg: null, version: input.detected?.version ?? null };
  }
  if (!input.detected) return null;
  return { command: input.detected.nodeExe, indexArg: input.detected.indexJs, version: input.detected.version };
}

export function buildCursorArgs(input: {
  indexArg: string | null;
  workspace: string;
  message: string;
  chatId?: string | null;
  model?: string | null;
}): string[] {
  const args = [
    ...(input.indexArg ? [input.indexArg] : []),
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--trust",
    "--approve-mcps",
    "--workspace",
    input.workspace,
  ];
  if (input.chatId) args.push("--resume", input.chatId);
  if (input.model?.trim()) args.push("--model", input.model.trim());
  args.push(input.message);
  if (args.includes("--force") || args.includes("--yolo") || args.includes("-f")) {
    throw new Error("Cursor operator must not pass --force");
  }
  return args;
}
