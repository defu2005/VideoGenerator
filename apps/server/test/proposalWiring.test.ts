import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftRunner } from "../src/operator/proposalDraft.js";
import { ensureProposalRoot, resolveProposalDraft } from "../src/operator/proposalWiring.js";

// TASK-074c-3c-2b: wiring helpers. No model call and no network: the factory is a vi.fn stub.
const runner: DraftRunner = async () => "# IMP";
const dirs: string[] = [];
function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "imp-wiring-")));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("TASK-074c-3c-2b: resolveProposalDraft", () => {
  it("no option gives undefined and never calls the runner factory", () => {
    const makeRunner = vi.fn(() => runner);
    expect(resolveProposalDraft(undefined, makeRunner)).toBeUndefined();
    expect(makeRunner).not.toHaveBeenCalled();
  });

  it("a given runner is kept as the same reference and the factory is not called", () => {
    const makeRunner = vi.fn(() => runner);
    const resolved = resolveProposalDraft({ root: "/some/root", runner }, makeRunner);
    expect(resolved?.runner).toBe(runner);
    expect(resolved?.root).toBe("/some/root");
    expect(makeRunner).not.toHaveBeenCalled();
  });

  it("a missing runner calls the factory exactly once and uses its result", () => {
    const makeRunner = vi.fn(() => runner);
    const resolved = resolveProposalDraft({ root: "/some/root" }, makeRunner);
    expect(makeRunner).toHaveBeenCalledTimes(1);
    expect(resolved?.runner).toBe(runner);
  });

  it("a caller-supplied runner returns the same object, so later changes to root and runner are seen at request time", () => {
    const option: { root: string; runner?: DraftRunner } = { root: "/first", runner };
    const resolved = resolveProposalDraft(option, () => runner);
    const other: DraftRunner = async () => "# other";
    option.root = "/second";
    option.runner = other;
    expect(resolved).toBe(option);
    expect(resolved?.root).toBe("/second");
    expect(resolved?.runner).toBe(other);
  });

  it("keeps an injected ensureRoot hook", () => {
    const ensureRoot = vi.fn();
    const resolved = resolveProposalDraft({ root: "/some/root", runner, ensureRoot }, () => runner);
    expect(resolved?.ensureRoot).toBe(ensureRoot);
  });
});

describe("TASK-074c-3c-2b: ensureProposalRoot", () => {
  it("creates a missing leaf when its parent exists", () => {
    const leaf = join(tempDir(), "proposals");
    ensureProposalRoot(leaf);
    expect(existsSync(leaf)).toBe(true);
  });

  it("creates nothing and does not throw when the parent is missing", () => {
    const leaf = join(tempDir(), "missing", "proposals");
    expect(() => ensureProposalRoot(leaf)).not.toThrow();
    expect(existsSync(leaf)).toBe(false);
  });
});
