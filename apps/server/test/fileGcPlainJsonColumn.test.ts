import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectReferences, referencesForPath } from "../src/storage/references.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// Regression: the real DB holds app_settings rows whose json-typed `value` is a plain string
// (e.g. change.schedule.* stamps such as "2026-11-17T09:34:35.438Z"). The walker threw on every
// such row, so collectReferences failed and orphan GC never ran.

describe("reference collection with plain-string json columns", () => {
  it("does not throw for plain scalar strings stored in a json column", () => {
    const harness = createPipelineHarness();
    const root = mkdtempSync(join(tmpdir(), "gc-plain-json-"));
    try {
      harness.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)")
        .run("change.schedule.prune", "2026-11-17T09:34:35.438Z", harness.clock().toISOString());
      harness.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)")
        .run("analyticsChannelDaily:x", "2026-11-18", harness.clock().toISOString());
      expect(() => collectReferences(harness.sqlite, root, { now: harness.clock() })).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still fails closed when a JSON-looking value cannot be parsed", () => {
    const harness = createPipelineHarness();
    const root = mkdtempSync(join(tmpdir(), "gc-corrupt-json-"));
    try {
      harness.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)")
        .run("corrupt:x", "{\"path\": \"visuals/a.jpg\"", harness.clock().toISOString());
      expect(() => collectReferences(harness.sqlite, root, { now: harness.clock() }))
        .toThrow(/Invalid file-reference JSON in app_settings\.value/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps protecting a path that is valid JSON in the same column", () => {
    const harness = createPipelineHarness();
    const root = mkdtempSync(join(tmpdir(), "gc-valid-json-"));
    try {
      harness.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)")
        .run("ref:x", JSON.stringify({ path: "projects/p/visuals/a.jpg" }), harness.clock().toISOString());
      const graph = collectReferences(harness.sqlite, root, { now: harness.clock() });
      const refs = referencesForPath(graph, resolve(root, "projects/p/visuals/a.jpg"), root);
      expect(refs.some((ref) => ref.table === "app_settings")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
