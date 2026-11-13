import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cursorProjectSlug, findGitRoot, mcpApprovalId, operatorDir } from "../src/operator/workspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("operator workspace location", () => {
  it("keeps the operator folder outside a git work tree", () => {
    const root = mkdtempSync(join(tmpdir(), "vg-op-git-"));
    roots.push(root);
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, ".git"), "gitdir: fake\n");
    const dir = operatorDir(join(root, "data"));
    expect(findGitRoot(dir)).toBeNull();
    expect(dir.endsWith(".video-agent-operator")).toBe(true);
  });

  it("builds the CLI project slug and approval id", () => {
    const workspace = "C:\\Users\\defu\\Documents\\.video-agent-operator";
    expect(cursorProjectSlug(workspace)).toBe("C-Users-defu-Documents-video-agent-operator");
    const server = { command: "node.exe", args: ["index.js"], env: { VG_API_URL: "http://127.0.0.1:3001" } };
    const id = mcpApprovalId(workspace, "video-agent", server);
    expect(id.startsWith("video-agent-")).toBe(true);
    expect(id).toHaveLength("video-agent-".length + 16);
    expect(mcpApprovalId(workspace, "video-agent", server)).toBe(id);
  });
});
