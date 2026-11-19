import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { actorWith } from "./testActor.js";
import { consumeSelfImprovementBudget, saveSelfImprovementSettings, selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";

let opened: ReturnType<typeof openDatabase>;
const now = new Date("2026-11-15T10:00:00Z");
beforeEach(() => { opened = openDatabase(":memory:"); migrateDatabase(opened.db, undefined, opened.sqlite); });
afterEach(() => opened.sqlite.close());
const scoped = <T>(workspaceId: string, fn: () => T) => runAsActor(actorWith({ role: "owner", workspaceId }), fn);
it("reserves all six shared counters and refuses the operation before exceeding a cap", () => scoped("A", () => {
  const db = opened.sqlite;
  const initial = selfImprovementBudgetStatus(db, now);
  expect(initial.limits).toEqual({ researchRuns: 3, llmCalls: 40, webFetches: 60, skillDrafts: 3, behaviourEvals: 10, improvementRequests: 10 });
  for (let i = 0; i < 3; i++) consumeSelfImprovementBudget(db, "researchRuns", { now });
  expect(() => consumeSelfImprovementBudget(db, "researchRuns", { now })).toThrow("Đã đạt giới hạn");
  expect(selfImprovementBudgetStatus(db, now).used.researchRuns).toBe(3);
  consumeSelfImprovementBudget(db, "llmCalls", { now }); consumeSelfImprovementBudget(db, "webFetches", { now });
  expect(selfImprovementBudgetStatus(db, now).used).toMatchObject({ llmCalls: 1, webFetches: 1 });
}));
it("isolates workspaces and resets counters on the Vietnam calendar day", () => {
  const db = opened.sqlite, boundary = new Date("2026-11-15T17:00:00Z");
  scoped("A", () => consumeSelfImprovementBudget(db, "researchRuns", { now }));
  scoped("B", () => expect(selfImprovementBudgetStatus(db, now).used.researchRuns).toBe(0));
  scoped("A", () => {
    expect(selfImprovementBudgetStatus(db, new Date(boundary.getTime() - 1)).used.researchRuns).toBe(1);
    expect(selfImprovementBudgetStatus(db, boundary).used.researchRuns).toBe(0);
  });
});
it("disables automatic research/drafting in ECO while allowing manual runs within the same budget", () => scoped("A", () => {
  const db = opened.sqlite;
  saveSelfImprovementSettings(db, { eco: true, budget: { researchRuns: 1 } }, now);
  for (const counter of ["researchRuns", "skillDrafts"] as const) expect(() => consumeSelfImprovementBudget(db, counter, { now })).toThrow("Chế độ hiện tại");
  consumeSelfImprovementBudget(db, "researchRuns", { now, manual: true });
  expect(() => consumeSelfImprovementBudget(db, "researchRuns", { now, manual: true })).toThrow("Đã đạt giới hạn");
  expect(() => saveSelfImprovementSettings(db, { budget: { researchRuns: -1 } }, now)).toThrow();
}));
