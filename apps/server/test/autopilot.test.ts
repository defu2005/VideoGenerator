import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AUTONOMY_PRESETS } from "@vg/shared";
import {
  agentMayChange, alertWaitsForMorning, applyGoalToAutomation, canaryUndo, cleanupTempCache,
  consumeRaiseCode, createUserRequest, finishCanary, goalIsBehind, guidelineWins, markUserTouch,
  nextFairProfile, preferenceBlock, raiseCode, saveGoal, savePreference, sensitivePublish,
  setDrain, stalledBackoffMinutes, startCanary, stopAutonomy,
} from "../src/operator/autopilot.js";
import { deleteAppCombo, patchOmnirouteProvider, readOmnirouteProviders, upsertOmnirouteCombo } from "../src/providerIntel/omniroute.js";
import { saveAutonomySettings } from "../src/operator/autonomy.js";

function db() {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE IF NOT EXISTS organization (id TEXT PRIMARY KEY, created_at INTEGER);"
    + "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);"
    + "CREATE TABLE profiles (id TEXT PRIMARY KEY, automation TEXT, archived_at TEXT, workspace_id TEXT);"
    + "CREATE TABLE operator_goals (id TEXT PRIMARY KEY, profile_id TEXT, text TEXT NOT NULL, spec TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source TEXT NOT NULL, workspace_id TEXT);"
    + "CREATE TABLE operator_preferences (id TEXT PRIMARY KEY, profile_id TEXT, rule TEXT NOT NULL, quote TEXT NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL, workspace_id TEXT);"
    + "CREATE TABLE operator_requests (id TEXT PRIMARY KEY, profile_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, why_vi TEXT NOT NULL, action_url TEXT NOT NULL, dedupe_key TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, check_kind TEXT NOT NULL, check_args TEXT NOT NULL);"
    + "CREATE TABLE operator_user_touches (object_key TEXT PRIMARY KEY, touched_at TEXT NOT NULL);"
    + "CREATE TABLE routing_canaries (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, stage TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, reason TEXT NOT NULL, remaining INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);");
  sqlite.prepare("INSERT INTO profiles (id, automation, archived_at) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}', NULL)").run();
  return sqlite;
}

describe("autopilot", () => {
  it("caps an impossible goal and maps the plan onto automation", () => {
    const sqlite = db();
    const saved = saveGoal(sqlite, {
      profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      text: "10 video mỗi ngày",
      source: "web",
      spec: { videosPerDay: 10, platforms: ["youtube"], formats: ["long"], topicFocus: ["sử"], avoid: [] },
    });
    expect(saved.warning).toMatch(/6/);
    saveAutonomySettings(sqlite, { level: "autonomous", grants: AUTONOMY_PRESETS.autonomous });
    saveAutonomySettings(sqlite, { level: "autonomous", grants: AUTONOMY_PRESETS.autonomous }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const plan = applyGoalToAutomation(sqlite, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(plan.applied).toBe(true);
    expect(plan.plan).toMatchObject({ videos: 6, capped: true });
    expect(goalIsBehind(1, 7)).toBe(true);
    sqlite.close();
  });

  it("retires a conflicting preference and injects the new rule", () => {
    const sqlite = db();
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    savePreference(sqlite, { profileId: id, rule: "dùng nhạc vui", quote: "nhạc vui", scope: ["script"] });
    const next = savePreference(sqlite, { profileId: id, rule: "dùng nhạc buồn", quote: "nhạc buồn", scope: ["script"] });
    expect(next.retired).toEqual(["dùng nhạc vui"]);
    expect(preferenceBlock(sqlite, id, "script")).toMatch(/nhạc buồn/);
    expect(guidelineWins("hãy đăng ngay", "không được đăng chủ đề này").follow).toBe("guideline");
    sqlite.close();
  });

  it("dedupes requests, caps questions and cleans only temp files", () => {
    const sqlite = db();
    const first = createUserRequest(sqlite, {
      kind: "needs_key", title: "Gemini", whyVi: "Cần key", actionUrl: "/settings/keys?provider=gemini",
      dedupeKey: "gemini", checkKind: "secret",
    });
    const second = createUserRequest(sqlite, {
      kind: "needs_key", title: "Gemini", whyVi: "Cần key", actionUrl: "/settings/keys?provider=gemini",
      dedupeKey: "gemini", checkKind: "secret",
    });
    expect(second).toEqual({ id: first.id, created: false });
    expect(() => createUserRequest(sqlite, {
      kind: "info", title: "hỏi", whyVi: "hỏi", actionUrl: "https://evil.example", dedupeKey: "x", checkKind: "info",
    })).toThrow(/trang trong app/);
    const root = mkdtempSync(join(tmpdir(), "vg-clean-"));
    writeFileSync(join(root, "keep.txt"), "data");
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const tmp = join(root, "tmp");
    const cache = join(root, "cache");
    mkdirSync(tmp);
    mkdirSync(cache);
    writeFileSync(join(tmp, "old.bin"), "x");
    writeFileSync(join(cache, "old.bin"), "x");
    utimesSync(join(tmp, "old.bin"), old, old);
    utimesSync(join(cache, "old.bin"), old, old);
    const removed = cleanupTempCache(root, new Date());
    expect(removed).toHaveLength(2);
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("data");
    rmSync(root, { recursive: true, force: true });
    expect(stalledBackoffMinutes(0)).toBe(1);
    expect(stalledBackoffMinutes(3)).toBeNull();
    expect(sensitivePublish("bầu cử", "public").visibility).toBe("private");
    sqlite.close();
  });

  it("promotes a canary, rolls a worse one back and locks a user edit", () => {
    const sqlite = db();
    const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const good = startCanary(sqlite, {
      profileId, stage: "SCRIPT", before: { provider: "mock", model: "a" }, after: { provider: "mock", model: "b" },
      reason: "điểm cao hơn", configured: true, projectedDailyUsd: 1, dailyUsd: 2,
    });
    expect(finishCanary(sqlite, good.id, { quality: 8, baselineQuality: 8, failures: 0 })).toBe("running");
    expect(finishCanary(sqlite, good.id, { quality: 8, baselineQuality: 8, failures: 0 })).toBe("promoted");
    const bad = startCanary(sqlite, {
      profileId, stage: "TTS", before: { provider: "mock", model: "a" }, after: { provider: "mock", model: "c" },
      reason: "thử", configured: true, projectedDailyUsd: 1, dailyUsd: 2,
    });
    finishCanary(sqlite, bad.id, { quality: 1, baselineQuality: 1, failures: 0 });
    expect(finishCanary(sqlite, bad.id, { quality: 4, baselineQuality: 8, failures: 1 })).toBe("rolled_back");
    expect(canaryUndo(sqlite, good.id)).toEqual({ provider: "mock", model: "a" });
    expect(() => startCanary(sqlite, {
      profileId, stage: "SCRIPT", before: { provider: "mock", model: "a" }, after: { provider: "mock", model: "z" },
      reason: "chưa có", configured: false, projectedDailyUsd: 1, dailyUsd: 2,
    })).toThrow(/chưa được cấu hình/);
    markUserTouch(sqlite, "route:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:SCRIPT");
    expect(agentMayChange(sqlite, "route:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:SCRIPT")).toBe(false);
    sqlite.close();
  });

  it("stops autonomy, drains and requires a code to raise access", () => {
    const sqlite = db();
    saveAutonomySettings(sqlite, { level: "autonomous", grants: AUTONOMY_PRESETS.autonomous });
    stopAutonomy(sqlite);
    expect(setDrain(sqlite, true).draining).toBe(true);
    const code = raiseCode(sqlite);
    expect(consumeRaiseCode(sqlite, "000000")).toBe(false);
    const again = raiseCode(sqlite);
    expect(consumeRaiseCode(sqlite, again)).toBe(true);
    expect(code).toMatch(/\d{6}/);
    expect(nextFairProfile(sqlite, ["a", "b"])).toBe("a");
    expect(nextFairProfile(sqlite, ["a", "b"])).toBe("b");
    expect(alertWaitsForMorning("warn", new Date("2026-11-09T17:30:00.000Z"))).toBe(true);
    expect(alertWaitsForMorning("critical", new Date("2026-11-09T17:30:00.000Z"))).toBe(false);
    sqlite.close();
  });

  it("strips OmniRoute secrets and backs up before a write", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const body = url.endsWith("/providers") ? [{ id: "p1", provider: "gemini", apiKey: "secret", models: ["g"], isActive: true }] : { id: "bak" };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const input = { origin: "http://127.0.0.1:20128", token: "oma_live_test", fetchImpl };
    const listed = await readOmnirouteProviders(input);
    expect(listed[0]).toEqual({ id: "p1", provider: "gemini", label: "", active: true, priority: 0, modelCount: 1, lastTest: null });
    expect(JSON.stringify(listed)).not.toMatch(/secret/);
    await patchOmnirouteProvider(input, "p1", { isActive: false });
    expect(calls.some((line) => line.startsWith("GET") && line.includes("/api/db-backups/export"))).toBe(true);
    await expect(patchOmnirouteProvider(input, "p1", { apiKey: "nope" })).rejects.toThrow(/Từ chối/);
    await upsertOmnirouteCombo(input, { name: "vg-video", models: ["g"] }, ["g"]);
    await expect(deleteAppCombo(input, { id: "c", name: "custom" })).rejects.toThrow(/vg-/);
  });
});
