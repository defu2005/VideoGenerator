import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { defaultWorkspaceId } from "../src/auth/workspaces.js";
import { findingWillOpen, publishFindingOpened } from "../src/operator/findingEvents.js";
import { subscribeAgentEvents } from "../src/events/agentBus.js";

// TASK-129a: a direct-INSERT finding emits supervisor_finding only when a row actually opens.
const roots: string[] = [];
const handles: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) { try { h.close(); } catch { /* closed */ } }
  for (const r of roots.splice(0)) { try { rmSync(r, { recursive: true, force: true }); } catch { /* Windows lag */ } }
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-finding-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  handles.push(opened.sqlite);
  // Seed only the organization row: defaultWorkspaceId reads it; member/user FKs are not needed here.
  opened.sqlite.prepare("INSERT INTO organization (id, name, slug, created_at, metadata) VALUES (?, 'Test', 'test', ?, '{}')")
    .run("ws-default", Date.now());
  return opened.sqlite;
}

function capture() {
  const seen: Array<{ event: AgentEvent; workspaceId?: string }> = [];
  const off = subscribeAgentEvents((event, workspaceId) => {
    if (event.type === "supervisor_finding") seen.push({ event, workspaceId });
  });
  return { seen, off };
}

describe("findingWillOpen", () => {
  it("is true for a missing key and for a resolved row, false for an open row", () => {
    const db = setup();
    expect(findingWillOpen(db, "k-missing")).toBe(true);
    db.prepare(`INSERT INTO supervisor_findings (id, dedupe_key, kind, severity, detail, first_seen_at, last_seen_at, status)
      VALUES ('f-1', 'k-open', 'loop_guard', 'warn', '{}', '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z', 'open')`).run();
    expect(findingWillOpen(db, "k-open")).toBe(false);
    db.prepare(`UPDATE supervisor_findings SET status = 'resolved' WHERE dedupe_key = 'k-open'`).run();
    expect(findingWillOpen(db, "k-open")).toBe(true);
  });
});

describe("publishFindingOpened", () => {
  it("publishes a global event (no workspace) when the finding has no profile", () => {
    const db = setup();
    const { seen, off } = capture();
    try {
      const before = seen.length;
      publishFindingOpened(db, { summary: "Vòng lặp phát hiện", profileId: null });
      expect(seen.length - before).toBe(1);
      expect(seen[seen.length - 1].workspaceId).toBeUndefined();
      expect(seen[seen.length - 1].event).toMatchObject({ type: "supervisor_finding", summary: "Vòng lặp phát hiện" });
    } finally { off(); }
  });

  it("uses the profile's own workspace_id when it has one", () => {
    const db = setup();
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO profiles (id, name, default_brief, guidelines, created_at, updated_at, workspace_id)
      VALUES ('p-ws', 'Hồ sơ A', '{}', '{}', ?, ?, 'ws-a')`).run(at, at);
    const { seen, off } = capture();
    try {
      publishFindingOpened(db, { summary: "Hồ sơ có workspace", profileId: "p-ws" });
      expect(seen[seen.length - 1].workspaceId).toBe("ws-a");
    } finally { off(); }
  });

  it("scopes a profile finding to the default workspace and trims the summary to 200 chars", () => {
    const db = setup();
    const { seen, off } = capture();
    try {
      const before = seen.length;
      const fallback = defaultWorkspaceId(db);
      expect(fallback, "migrated DB must have a default workspace for this check to mean anything").not.toBeNull();
      publishFindingOpened(db, { summary: "x".repeat(300), profileId: "no-such-profile" });
      expect(seen.length - before).toBe(1);
      expect(seen[seen.length - 1].workspaceId).toBe(fallback ?? undefined);
      expect((seen[seen.length - 1].event as { summary: string }).summary).toHaveLength(200);
    } finally { off(); }
  });
});
