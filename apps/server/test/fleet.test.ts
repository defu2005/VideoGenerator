import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { actorWith } from "./testActor.js";
import { buildFleetBundle, fleetHeartbeat, fleetOverview, saveFleetDraft, saveFleetSettings } from "../src/fleet/service.js";
import { lessonsDigest, recordLesson, searchLessons } from "../src/fleet/lessons.js";
import { activateSkillVersion, listSkillVersions } from "../src/operator/skillVersions.js";
import { ASSISTANT_TOOLS, type AssistantToolContext } from "../src/assistant/tools.js";
import { FleetFileSchema } from "@vg/shared";
import { dutyHeartbeat } from "../src/supervision/duty.js";
import { fleetToolDefs } from "../src/fleet/toolDefs.js";
import { buildSupervisionSnapshot } from "../src/supervision/snapshot.js";
import { readMcpHealth } from "../src/api/health.js";

let opened: ReturnType<typeof openDatabase>;
const now = new Date("2026-11-15T03:00:00Z");
const hermes = { kind: "hermes" as const, name: "wsl", instance: "hermes/wsl", model: null, environment: "wsl", canSupervise: true, trusted: true };
beforeEach(() => {
  opened = openDatabase(":memory:"); migrateDatabase(opened.db, undefined, opened.sqlite);
  for (const id of ["A", "B"]) opened.sqlite.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES (?,?,?,1)").run(id, id, id);
});
afterEach(() => opened.sqlite.close());
const scoped = <T>(fn: () => T, workspaceId = "A") => runAsActor(actorWith({ role: "owner", workspaceId }), fn);
const registry = () => new Map(Object.values(ASSISTANT_TOOLS).map((t) => [t.name, t.risk]));
function markdown(name = "video-fleet-fixture") {
  return `---\nname: ${name}\ndescription: Đọc trạng thái trong thử nghiệm ${name}\noperator: true\narea: tu-van-hanh\ntriggers:\n  - thử nghiệm ${name}\ntools:\n  - list_projects\nrisk: read\n---\n\n# Thử nghiệm\n\n## Khi nào dùng\nKhi thử nghiệm ${name}.\n\n## Các bước\n1. Gọi list_projects.\n\n## Kiểm tra kết quả\nCó danh sách.\n\n## Lỗi hay gặp\nUNKNOWN_TOOL nếu sai tên.\n\n## Không được làm\nKhông đổi trạng thái.\n`;
}
const draft = (extra: object = {}) => ({ name: "video-fleet-fixture", markdown: markdown(), evidence: { reason: "Lặp lại ba lần", runIds: ["fixture-run"] }, ...extra });

it("exports only active skills and safe files, keeps secrets out, and advances the version for each content change", () => scoped(() => {
  const db = opened.sqlite;
  db.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES ('provider.api_key','known-fixture-secret','now')").run();
  const a = buildFleetBundle(db, { now });
  expect(JSON.stringify(a)).not.toContain("known-fixture-secret");
  expect(a.files.map((f) => f.path)).toEqual(expect.arrayContaining(["vg-handbook/SKILL.md", "vg-fleet-lessons/SKILL.md", "vg-supervise/SKILL.md"]));
  expect(buildFleetBundle(db, { now }).bundleVersion).toBe(a.bundleVersion);
  const saved = saveFleetDraft(db, hermes, draft());
  expect(buildFleetBundle(db, { now }).files.some((f) => f.path.startsWith("video-fleet-fixture/"))).toBe(false);
  activateSkillVersion(db, saved.name, saved.version, registry());
  const b = buildFleetBundle(db, { now }); expect(b.bundleVersion).toBeGreaterThan(a.bundleVersion);
  expect(b.skillVersions["video-fleet-fixture"]).toBe(1);
  saveFleetSettings(db, { model: "fixture-new" });
  const c = buildFleetBundle(db, { now }); expect(c.bundleVersion).toBeGreaterThan(b.bundleVersion);
  recordLesson(db, { scope: "global", text: "Dùng ảnh đã được kiểm tra", evidence: { runIds: ["run"] } }, hermes, now);
  expect(buildFleetBundle(db, { now }).bundleVersion).toBeGreaterThan(c.bundleVersion);
  for (const path of ["../secret.md", "/absolute/SKILL.md", "C:/secret.md", "ok/../../bad.md", "ok/.env", "ok/file.js"]) expect(FleetFileSchema.safeParse({ path, content: "x" }).success, path).toBe(false);
  saveFleetSettings(db, { model: "known-fixture-secret" });
  expect(() => buildFleetBundle(db, { now })).toThrow("Gói chứa giá trị bí mật");
}));

it("retains separate agent drafts, marks stale parents for merge, and auto-activates read-only skills only when enabled", () => scoped(() => {
  const db = opened.sqlite;
  const first = saveFleetDraft(db, hermes, draft());
  expect(first.status).toBe("draft");
  const second = saveFleetDraft(db, { ...hermes, instance: "hermes/other" }, draft());
  expect(second.version).toBe(first.version + 1);
  activateSkillVersion(db, first.name, first.version, registry());
  const stale = saveFleetDraft(db, hermes, draft({ markdown: `${markdown()}\nThêm ghi chú.` }));
  expect(stale.status).toBe("needs_merge");
  expect(() => activateSkillVersion(db, stale.name, stale.version, registry())).toThrow("Gộp thay đổi");
  saveFleetSettings(db, { autoActivateReadOnlySkills: true });
  const fresh = saveFleetDraft(db, hermes, draft({ parentVersion: first.version, markdown: `${markdown()}\nGhi chú đã gộp.` }));
  expect(fresh.status).toBe("active");
  const mutatingMention = saveFleetDraft(db, hermes, { name: "video-no-auto", markdown: `${markdown("video-no-auto")}\nKhông dùng run_pipeline.`, evidence: { reason: "fixture" } });
  expect(mutatingMention.status).toBe("draft");
  expect(listSkillVersions(db).filter((s) => s.status === "active")).toHaveLength(1);
}));

it("deduplicates and scopes lessons, caps the digest, and requires current Hermes duty to retire", async () => scoped(async () => {
  const db = opened.sqlite;
  const first = recordLesson(db, { scope: "global", text: "Kiểm tra ảnh", evidence: { runIds: ["one"] } }, hermes, now);
  expect(recordLesson(db, { scope: "global", text: "  KIỂM TRA  ảnh ", evidence: { runIds: ["two"] } }, hermes, now).id).toBe(first.id);
  expect(searchLessons(db)[0]!.confirmedCount).toBe(2);
  scoped(() => expect(searchLessons(db)).toEqual([]), "B");
  for (let i = 0; i < 30; i++) recordLesson(db, { scope: "global", text: `${i}: ${"Bài học. ".repeat(30)}`, evidence: { run: "fixture" } }, hermes, now);
  expect(Buffer.byteLength(lessonsDigest(db))).toBeLessThanOrEqual(6000);
  const tool = fleetToolDefs.find((t) => t.name === "retire_lesson")!;
  const ctx = { sqlite: db, agent: hermes } as unknown as AssistantToolContext;
  expect(await tool.execute({ id: first.id, reason: "Cũ" }, ctx)).toMatchObject({ code: "NOT_ON_DUTY" });
  dutyHeartbeat(db, hermes, "fixture", new Date());
  expect(await tool.execute({ id: first.id, reason: "Cũ" }, ctx)).toMatchObject({ status: "retired" });
}));

it("computes each drift rule and includes it in the real supervision snapshot", () => scoped(() => {
  const db = opened.sqlite, bundle = buildFleetBundle(db, { now });
  fleetHeartbeat(db, hermes, { environment: "wsl", hermesVersion: bundle.hermesVersion, bundleVersion: bundle.bundleVersion, skillsHash: "fixture", toolHash: bundle.toolHash }, now);
  expect(fleetOverview(db, now).anomalies).toEqual([]);
  fleetHeartbeat(db, hermes, { environment: "wsl", hermesVersion: "0.1.0", bundleVersion: 0, skillsHash: "fixture", toolHash: "old", pendingCron: [bundle.cron[0]!.command] }, now);
  const later = new Date(now.getTime() + 16 * 60_000);
  const kinds = fleetOverview(db, later).anomalies.map((a) => a.kind);
  expect(kinds).toEqual(expect.arrayContaining(["fleet_offline", "fleet_bundle_behind", "fleet_version_drift", "fleet_tool_drift", "fleet_missing_cron"]));
  expect((buildSupervisionSnapshot(db, later).anomalies as Array<{ kind: string }>).some((a) => a.kind === "fleet_version_drift")).toBe(true);
  expect(() => fleetHeartbeat(db, hermes, { instance: "hermes/spoof", environment: "wsl", hermesVersion: "1", bundleVersion: 0, skillsHash: "", toolHash: "" }, now)).toThrow("Instance phải khớp");
}));

it("reads MCP liveness through a mock HTTP response and fails soft", async () => {
  expect(await readMcpHealth(undefined)).toMatchObject({ up: false });
  expect(await readMcpHealth("http://mcp.test/health", async () => Response.json({ up: true, toolCount: 4, toolHash: "fixture" }))).toMatchObject({ up: true, toolCount: 4 });
  expect(await readMcpHealth("http://mcp.test/health", async () => { throw new Error("offline"); })).toMatchObject({ up: false });
});

it("keeps workspace fleet versions separate and detects a bundle that changed after the last heartbeat", () => scoped(() => {
  const db = opened.sqlite, bundle = buildFleetBundle(db, { now });
  fleetHeartbeat(db, hermes, { environment: "wsl", hermesVersion: bundle.hermesVersion, bundleVersion: bundle.bundleVersion, skillsHash: "fixture", toolHash: bundle.toolHash }, now);
  scoped(() => {
    const b = buildFleetBundle(db, { now });
    fleetHeartbeat(db, { ...hermes, name: "other", instance: "hermes/other" }, { environment: "wsl", hermesVersion: b.hermesVersion, bundleVersion: b.bundleVersion, skillsHash: "fixture", toolHash: b.toolHash }, now);
    expect(fleetOverview(db, now).instances.map((item) => item.instance)).toEqual(["hermes/other"]);
  }, "B");
  saveFleetSettings(db, { model: "bundle-changed" });
  const changedAt = new Date(now.getTime() + 60_000);
  buildFleetBundle(db, { now: changedAt });
  const overview = fleetOverview(db, new Date(changedAt.getTime() + 16 * 60_000));
  expect(overview.instances.map((item) => item.instance)).toEqual([hermes.instance]);
  expect(overview.anomalies.some((item) => item.kind === "fleet_bundle_behind")).toBe(true);
}));
