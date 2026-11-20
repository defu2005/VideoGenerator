import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { writeProposalDraft } from "../src/operator/proposalWriter.js";

// TASK-074c-4a: the narrow writer for docs/proposals/. The root is injected, so these tests only touch temp dirs.
function tempDir(prefix: string) {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

function canMakeFileSymlink(): boolean {
  const base = tempDir("imp-probe-");
  const target = join(base, "target.txt");
  writeFileSync(target, "x");
  try {
    symlinkSync(target, join(base, "link.txt"));
    return true;
  } catch {
    return false;
  }
}
const fileSymlinkAvailable = canMakeFileSymlink();

describe("TASK-074c-4a: proposalWriter writes only IMP-<n>.md drafts inside the injected root", () => {
  it("writes a new draft and the bytes match", () => {
    const root = tempDir("imp-ok-");
    const body = "# IMP-7\n\nBản nháp guide\n";
    expect(writeProposalDraft(root, "IMP-7.md", body)).toEqual({ status: "written", path: join(root, "IMP-7.md") });
    expect(readFileSync(join(root, "IMP-7.md"), "utf8")).toBe(body);
  });

  it.each([
    ["../escape.md"],
    ["sub/IMP-1.md"],
    ["sub\\IMP-1.md"],
    ["IMP-1.md/../../escape.md"],
    ["C:\\x\\IMP-1.md"],
    ["/etc/IMP-1.md"],
    ["IMP-0.md"],
    ["IMP-01.md"],
    ["IMP-1234567890.md"],
    ["IMP-1.txt"],
    ["IMP-1.MD"],
    ["IMP-.md"],
    ["IMP-1.md:ads"],
    ["IMP-1.md."],
    ["IMP-1.md "],
    ["IMP-1.md\u0000"],
  ])("refuses the file name %j as bad_name and writes nothing", (name) => {
    const root = tempDir("imp-name-");
    const result = writeProposalDraft(root, name, "# draft");
    expect(result).toEqual({ status: "refused", reason: "bad_name" });
    expect(readdirSync(root)).toEqual([]);
    expect(existsSync(join(root, "..", "escape.md"))).toBe(false);
  });

  it("refuses when the root is a junction and writes nothing into the junction target", () => {
    const real = tempDir("imp-real-");
    const link = join(tempDir("imp-link-"), "proposals-link");
    symlinkSync(real, link, "junction");
    expect(writeProposalDraft(link, "IMP-1.md", "# draft")).toEqual({ status: "refused", reason: "bad_root" });
    expect(readdirSync(real)).toEqual([]);
  });

  it("refuses a relative root and writes nothing", () => {
    const root = tempDir("imp-relative-");
    const relativeRoot = relative(process.cwd(), root);
    expect(relativeRoot.length).toBeGreaterThan(0);
    expect(writeProposalDraft(relativeRoot, "IMP-6.md", "# draft")).toEqual({ status: "refused", reason: "bad_root" });
    expect(readdirSync(root)).toEqual([]);
  });

  it("refuses a root whose ancestor is a junction, and writes nothing into the junction target", () => {
    const real = tempDir("imp-anc-real-");
    mkdirSync(join(real, "proposals"));
    const link = join(tempDir("imp-anc-holder-"), "docs");
    symlinkSync(real, link, "junction");
    expect(writeProposalDraft(join(link, "proposals"), "IMP-1.md", "# draft")).toEqual({ status: "refused", reason: "bad_root" });
    expect(readdirSync(join(real, "proposals"))).toEqual([]);
  });

  it("refuses a target that is a junction, with no write into the junction's directory", () => {
    const outside = tempDir("imp-junction-target-");
    const root = tempDir("imp-junction-root-");
    symlinkSync(outside, join(root, "IMP-3.md"), "junction");
    expect(writeProposalDraft(root, "IMP-3.md", "evil")).toEqual({ status: "refused", reason: "unsafe_target" });
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses when the root does not exist and does not create it", () => {
    const missing = join(tempDir("imp-missing-"), "proposals");
    expect(writeProposalDraft(missing, "IMP-1.md", "# draft")).toEqual({ status: "refused", reason: "bad_root" });
    expect(existsSync(missing)).toBe(false);
  });

  it("refuses an existing draft and keeps its old content", () => {
    const root = tempDir("imp-exists-");
    expect(writeProposalDraft(root, "IMP-2.md", "first")).toMatchObject({ status: "written" });
    expect(writeProposalDraft(root, "IMP-2.md", "second")).toEqual({ status: "refused", reason: "exists" });
    expect(readFileSync(join(root, "IMP-2.md"), "utf8")).toBe("first");
  });

  it.skipIf(!fileSymlinkAvailable)("refuses when the target name is already a symlink and leaves the link's target alone", () => {
    const outside = join(tempDir("imp-outside-"), "outside.txt");
    writeFileSync(outside, "keep");
    const root = tempDir("imp-symlink-");
    symlinkSync(outside, join(root, "IMP-3.md"));
    expect(writeProposalDraft(root, "IMP-3.md", "evil")).toEqual({ status: "refused", reason: "unsafe_target" });
    expect(readFileSync(outside, "utf8")).toBe("keep");
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   \n\t "],
    ["a non-string", 42 as unknown as string],
    ["one byte over the cap", "a".repeat(100_001)],
  ])("refuses %s as bad_content and writes nothing", (_label, content) => {
    const root = tempDir("imp-content-");
    expect(writeProposalDraft(root, "IMP-4.md", content)).toEqual({ status: "refused", reason: "bad_content" });
    expect(readdirSync(root)).toEqual([]);
  });

  it("accepts content exactly at the 100000-byte cap", () => {
    const root = tempDir("imp-cap-");
    expect(writeProposalDraft(root, "IMP-5.md", "a".repeat(100_000))).toMatchObject({ status: "written" });
  });
});
