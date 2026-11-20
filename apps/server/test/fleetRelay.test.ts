import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { actorWith } from "./testActor.js";
import { buildFleetBundle, configureFleetRelay, fleetHeartbeat, fleetOverview, saveFleetSettings } from "../src/fleet/service.js";
import { LlmRelay, type RelayDeps } from "../src/providers/llm/relay.js";
import Fastify from "fastify";
import { registerFleetRoutes } from "../src/api/fleet.js";

let opened: ReturnType<typeof openDatabase>;
const now = new Date("2026-11-17T04:00:00Z");
const agent = { kind: "hermes" as const, name: "alpha", instance: "hermes/alpha", model: null,
  environment: "fixture", canSupervise: true, trusted: true };
beforeEach(() => { opened = openDatabase(":memory:"); migrateDatabase(opened.db, undefined, opened.sqlite); });
afterEach(() => opened.sqlite.close());
const scoped = <T>(fn: () => T, workspaceId = "A") => runAsActor(actorWith({ role: "owner", workspaceId }), fn);

function relay() {
  const fetchImpl = vi.fn(() => { throw new Error("Unexpected network request"); });
  const instance = new LlmRelay({ sqlite: opened.sqlite,
    config: { OMNIROUTE_API_KEY: "fixture-provider-secret", OMNIROUTE_MODEL: "blocked-old-model" },
    catalog: { getModels: async () => [], peekModels: () => [{ id: "allowed/catalog" }, { id: "workspace-b" }] } as unknown as RelayDeps["catalog"],
    quota: () => null, verifyApiKey: async () => ({ valid: false }), authenticateNode: () => undefined,
    fetchImpl: fetchImpl as typeof fetch, now: () => now });
  configureFleetRelay(opened.sqlite, instance);
  return { instance, fetchImpl };
}

it("uses the canonical caller and request workspace through the relay port while keeping credential templates", () => scoped(() => {
  const defaultModelFor = vi.fn(() => "allowed/model");
  const grantOf = vi.fn(() => ({ models: ["allowed/*"], enabled: true }));
  configureFleetRelay(opened.sqlite, { defaultModelFor, grantOf });
  saveFleetSettings(opened.sqlite, { model: "blocked-old-model" });
  const bundle = buildFleetBundle(opened.sqlite, { now, instance: agent.instance, secretValues: ["fixture-provider-secret"] });
  expect(defaultModelFor).toHaveBeenCalledExactlyOnceWith("agent:hermes/alpha", "A");
  expect(grantOf).toHaveBeenCalledExactlyOnceWith("agent:hermes/alpha", "A");
  expect(bundle.configPatch.model).toMatchObject({ default: "allowed/model", base_url: "${VG_API_URL}/api/llm/relay/v1" });
  const serialized = JSON.stringify(bundle);
  expect(serialized).toContain("${VG_API_KEY}");
  expect(serialized).not.toContain("fixture-provider-secret");
  expect(serialized).not.toContain("blocked-old-model");
}));

it("inherits workspace defaults and applies a caller override without crossing workspaces", () => {
  const { instance, fetchImpl } = relay();
  instance.saveGrant("*", { models: ["allowed/default"] }, "A");
  instance.saveGrant("*", { models: ["workspace-b"] }, "B");
  instance.saveGrant("agent:hermes/alpha", { models: ["allowed/alpha"] }, "A");
  const a = scoped(() => buildFleetBundle(opened.sqlite, { now, instance: agent.instance }));
  const other = scoped(() => buildFleetBundle(opened.sqlite, { now, instance: "hermes/other" }));
  const b = scoped(() => buildFleetBundle(opened.sqlite, { now, instance: agent.instance }), "B");
  expect(a.configPatch.model.default).toBe("allowed/alpha");
  expect(other.configPatch.model.default).toBe("allowed/default");
  expect(b.configPatch.model.default).toBe("workspace-b");
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("selects a matching catalog model for wildcard grants even when fleet and server settings name a forbidden model", () => scoped(() => {
  const { instance, fetchImpl } = relay();
  saveFleetSettings(opened.sqlite, { model: "blocked-old-model" });
  instance.saveGrant("agent:hermes/alpha", { models: ["allowed/*"] }, "A");
  expect(buildFleetBundle(opened.sqlite, { now, instance: agent.instance }).configPatch.model.default).toBe("allowed/catalog");
  expect(fetchImpl).not.toHaveBeenCalled();
}));

it.each([
  { model: "", enabled: true },
  { model: "forbidden/model", enabled: true },
  { model: "allowed/model", enabled: false },
])("keeps assets, heartbeat and overview available with an empty model ($enabled, $model)", ({ model, enabled }) => scoped(() => {
  configureFleetRelay(opened.sqlite, { defaultModelFor: () => model, grantOf: () => ({ models: ["allowed/*"], enabled }) });
  saveFleetSettings(opened.sqlite, { model: "blocked-old-model" });
  const bundle = buildFleetBundle(opened.sqlite, { now, instance: agent.instance });
  expect(bundle.configPatch.model.default).toBe("");
  expect(bundle.files.some((file) => file.path === "vg-handbook/SKILL.md")).toBe(true);
  const heartbeat = fleetHeartbeat(opened.sqlite, agent, { environment: "fixture", hermesVersion: bundle.hermesVersion,
    bundleVersion: bundle.bundleVersion, skillsHash: "fixture", toolHash: bundle.toolHash }, now);
  expect(heartbeat.ok).toBe(true);
  expect(fleetOverview(opened.sqlite, now).instances.some((row) => row.instance === agent.instance)).toBe(true);
}));

it("serves authenticated asset sync without OmniRoute while relay calls remain unavailable", async () => {
  const fetchImpl = vi.fn(() => { throw new Error("Unexpected network request"); });
  const catalog = { getModels: vi.fn(async () => { throw new Error("No OmniRoute configured"); }), peekModels: () => [] };
  const relay = new LlmRelay({ sqlite: opened.sqlite, config: {}, catalog: catalog as unknown as RelayDeps["catalog"],
    quota: () => null, verifyApiKey: async () => ({ valid: false }), authenticateNode: () => undefined,
    fetchImpl: fetchImpl as typeof fetch, now: () => now });
  configureFleetRelay(opened.sqlite, relay);
  opened.sqlite.prepare(`INSERT INTO apikey (id,name,reference_id,key,enabled,created_at,updated_at)
    VALUES ('fleet-key','Fixture','fixture-user','fixture-hash',1,1,1)`).run();
  opened.sqlite.prepare(`INSERT INTO agent_key_profiles (key_id,agent_kind,instance_name,can_supervise,updated_at)
    VALUES ('fleet-key','hermes','alpha',0,'now')`).run();
  const app = Fastify();
  // Simulate the verified actor supplied by the auth guard; Fleet still resolves
  // its trusted identity from the stored agent key profile.
  app.addHook("preHandler", (request, _reply, done) => {
    if (request.headers.authorization === "Bearer fixture-agent-key") {
      request.actor = { ...actorWith({ role: "owner", workspaceId: "A", kind: "apikey" }), keyId: "fleet-key" };
      runAsActor(request.actor, done);
    } else done();
  });
  registerFleetRoutes(app, opened.sqlite);
  try {
    expect((await app.inject({ method: "GET", url: "/api/agents/bundle" })).statusCode).toBe(403);
    const response = await app.inject({ method: "GET", url: "/api/agents/bundle", headers: { authorization: "Bearer fixture-agent-key" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().configPatch.model.default).toBe("");
    expect(response.json().files.length).toBeGreaterThan(0);
    await expect(relay.relay("chat/completions", { caller: "agent:hermes/alpha", workspaceId: "A", label: "Fixture" },
      { model: "forbidden-old-model", messages: [] })).rejects.toMatchObject({ status: 503, code: "LLM_RELAY_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(catalog.getModels).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it("uses the same model policy in heartbeat/overview and advances the bundle only when its effective model changes", () => scoped(() => {
  const { instance } = relay();
  instance.saveGrant("*", { models: ["allowed/default"] }, "A");
  const first = buildFleetBundle(opened.sqlite, { now, instance: agent.instance });
  saveFleetSettings(opened.sqlite, { model: "another-ignored-fleet-model" });
  expect(buildFleetBundle(opened.sqlite, { now, instance: agent.instance }).bundleVersion).toBe(first.bundleVersion);
  instance.saveGrant("agent:hermes/alpha", { models: ["allowed/updated"] }, "A");
  const updated = buildFleetBundle(opened.sqlite, { now, instance: agent.instance });
  expect(updated.bundleVersion).toBeGreaterThan(first.bundleVersion);
  expect(updated.hash).not.toBe(first.hash);
  const heartbeat = fleetHeartbeat(opened.sqlite, agent, { environment: "fixture", hermesVersion: updated.hermesVersion,
    bundleVersion: updated.bundleVersion, skillsHash: "fixture", toolHash: updated.toolHash }, now);
  expect(heartbeat.bundleVersion).toBe(updated.bundleVersion);
  const overview = fleetOverview(opened.sqlite, now);
  expect(overview.instances.find((row) => row.instance === agent.instance)?.expectedBundleVersion).toBe(updated.bundleVersion);
}));
