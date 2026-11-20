import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { claimBreakerTrial, recordBreakerOutcome } from "../src/operator/circuitBreaker.js";
import { subscribeAgentEvents } from "../src/events/agentBus.js";

// TASK-129a: the circuit breaker emits supervisor_finding only when its finding actually opens.
const roots: string[] = [];
const handles: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) { try { h.close(); } catch { /* closed */ } }
  for (const r of roots.splice(0)) { try { rmSync(r, { recursive: true, force: true }); } catch { /* Windows lag */ } }
});

const profileId = "22222222-2222-4222-8222-222222222222";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-breaker-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  handles.push(opened.sqlite);
  const at = new Date().toISOString();
  opened.sqlite.prepare(`INSERT INTO profiles (id, name, default_brief, guidelines, created_at, updated_at) VALUES (?, 'Hồ sơ', '{}', '{}', ?, ?)`)
    .run(profileId, at, at);
  return opened.sqlite;
}

function counter() {
  const hits: string[] = [];
  const off = subscribeAgentEvents((event: AgentEvent) => {
    if (event.type === "supervisor_finding") hits.push(String((event as { summary?: string }).summary));
  });
  return { hits, off };
}

describe("breaker finding emits", () => {
  it("emits once when the breaker opens, not again while it stays open, and again after a resolve and re-open", () => {
    const db = setup();
    const { hits, off } = counter();
    try {
      const now = () => new Date();
      // Three straight failures open the breaker on the third.
      for (const job of ["j1", "j2"]) recordBreakerOutcome(db, profileId, "SCRIPT", job, false, now());
      expect(hits.length).toBe(0);
      recordBreakerOutcome(db, profileId, "SCRIPT", "j3", false, now());
      expect(hits.length).toBe(1);
      expect(hits[0]).toContain("SCRIPT");

      // Still open: a failed trial re-opens the breaker but the finding was already open, so no emit.
      expect(claimBreakerTrial(db, profileId, "SCRIPT", "t1", new Date(Date.now() + 25 * 3600 * 1000))).toBe(true);
      recordBreakerOutcome(db, profileId, "SCRIPT", "t1", false, new Date(Date.now() + 25 * 3600 * 1000));
      expect(hits.length).toBe(1);

      // Trial succeeds: finding resolves. A new open afterwards emits again.
      const later = new Date(Date.now() + 50 * 3600 * 1000);
      expect(claimBreakerTrial(db, profileId, "SCRIPT", "t2", later)).toBe(true);
      recordBreakerOutcome(db, profileId, "SCRIPT", "t2", true, later);
      const status = (db.prepare("SELECT status FROM supervisor_findings WHERE dedupe_key = ?")
        .get(`breaker_open:${profileId}:SCRIPT`) as { status: string } | undefined)?.status;
      expect(status).toBe("resolved");
      for (const job of ["r1", "r2", "r3"]) recordBreakerOutcome(db, profileId, "SCRIPT", job, false, new Date(later.getTime() + 1000));
      expect(hits.length).toBe(2);
    } finally { off(); }
  });
});
