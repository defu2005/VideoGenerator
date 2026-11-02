import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { projectDir } from "../src/storage/paths.js";

const root = mkdtempSync(join(tmpdir(), "vg-paths-test-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("project storage paths", () => {
  it("resolves UUID project directories under DATA_DIR", () => {
    const path = projectDir(root, "550e8400-e29b-41d4-a716-446655440000");
    expect(relative(resolve(root), path).split("\\").join("/"))
      .toBe("projects/550e8400-e29b-41d4-a716-446655440000");
  });

  it.each(["../outside", "not-a-uuid", "550e8400-e29b-01d4-a716-446655440000"])(
    "rejects invalid project id %s",
    (id) => {
      expect(() => projectDir(root, id)).toThrow(/UUID/);
    },
  );
});
