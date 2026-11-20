import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { buildDigest } from "../src/operator/autopilot.js";
import { digestReferenceTime, runStandingPlans } from "../src/operator/planner.js";

// TASK-129c slice 3: the 07:00 digest reports the day that just closed; the 21:00 digest reports today.
// Vietnam is UTC+7 with no DST. Fakes only: in-memory db, fixed clocks.
let opened: ReturnType<typeof openDatabase>;
beforeEach(() => {
  opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
});
afterEach(() => opened.sqlite.close());

it("07:05 Vietnam time fires only the morning digest, once per day", () => {
  const morning = new Date("2026-11-18T00:05:00Z"); // 07:05 on 2026-11-18 in Vietnam
  const first = runStandingPlans(opened.sqlite, morning);
  expect(first.morningDigest).toBe(true);
  expect(first.digest).toBe(false);
  expect(runStandingPlans(opened.sqlite, new Date("2026-11-18T00:20:00Z")).morningDigest).toBe(false);
});

it("21:05 Vietnam time fires only the evening digest", () => {
  const evening = new Date("2026-11-18T14:05:00Z"); // 21:05 on 2026-11-18 in Vietnam
  const result = runStandingPlans(opened.sqlite, evening);
  expect(result.digest).toBe(true);
  expect(result.morningDigest).toBe(false);
});

it("the morning digest reports the previous Vietnam day, and the evening digest reports today", () => {
  const morningNow = new Date("2026-11-18T00:05:00Z");
  const morningDigest = buildDigest(opened.sqlite, () => digestReferenceTime(morningNow, true));
  expect(morningDigest.day).toBe("2026-11-17");
  const eveningNow = new Date("2026-11-18T14:05:00Z");
  const eveningDigest = buildDigest(opened.sqlite, () => digestReferenceTime(eveningNow, false));
  expect(eveningDigest.day).toBe("2026-11-18");
});
