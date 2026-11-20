import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmRelay, type RelayCaller, type RelayDeps } from "../src/providers/llm/relay.js";
import { registerLlmRelayRoutes } from "../src/api/llmRelay.js";
import { AppError } from "../src/lib/errors.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const caller = (workspaceId: string | null): RelayCaller => ({ caller: "agent:hermes/shared", workspaceId, label: "Shared name", instance: "hermes/shared" });
const chat = { model: "fast", messages: [{ role: "user", content: "fixture" }] };
function setup() {
  const h = createPipelineHarness(); cleanups.push(h.close);
  const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
  const relay = new LlmRelay({ sqlite: h.sqlite, config: { ...h.config, OMNIROUTE_API_KEY: "server-fixture-key",
    LLM_PRICES_JSON: JSON.stringify({ "omniroute:fast": { inputPerMTok: 0, outputPerMTok: 0 }, "omniroute:smart": { inputPerMTok: 0, outputPerMTok: 0 } }) },
    catalog: { getModels: async () => ["fast", "smart"].map((id) => ({ id, ownedBy: "fixture" })) } as unknown as RelayDeps["catalog"],
    quota: () => null, authenticateNode: () => undefined, verifyApiKey: async () => ({ valid: false }), fetchImpl, now: h.clock });
  return { ...h, relay, fetchImpl };
}
async function admin(h: ReturnType<typeof setup>) {
  const app = Fastify(); cleanups.push(() => app.close());
  app.addHook("onRequest", async (request) => {
    request.actor = { kind: request.headers["x-fixture-kind"] === "apikey" ? "apikey" : "user", userId: "fixture",
      workspaceId: String(request.headers["x-fixture-workspace"] ?? "A"), role: "owner", channelIds: "all", isInstanceOwner: false };
  });
  app.setErrorHandler((error, _request, reply) => error instanceof AppError
    ? reply.code(error.statusCode).send({ code: error.code }) : reply.code(500).send({ error: String(error) }));
  registerLlmRelayRoutes(app, h.relay);
  return app;
}

describe("LLM relay workspace isolation", () => {
  it("upgrades existing scoped and legacy grants without losing their policy", () => {
    const h = setup(), database = openDatabase(":memory:");
    cleanups.push(() => database.sqlite.close());
    const source = fileURLToPath(new URL("../drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const before = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= 83) };
    const folder = join(h.config.DATA_DIR, "pre-workspace-grant-migrations");
    mkdirSync(join(folder, "meta"), { recursive: true });
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(before));
    for (const entry of before.entries) copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: folder });
    database.sqlite.prepare("INSERT INTO llm_relay_grants(caller,workspace_id,rpm,updated_at) VALUES ('*',NULL,4,'before'),('node:old','A',7,'before')").run();
    migrateDatabase(database.db, undefined, database.sqlite);
    expect(database.sqlite.prepare("SELECT caller,workspace_id,rpm FROM llm_relay_grants ORDER BY caller").all())
      .toEqual([{ caller: "*", workspace_id: null, rpm: 4 }, { caller: "node:old", workspace_id: "A", rpm: 7 }]);
    database.sqlite.prepare("INSERT INTO llm_relay_grants(caller,workspace_id,updated_at) VALUES ('node:old','B','after')").run();
    expect(() => database.sqlite.prepare("INSERT INTO llm_relay_grants(caller,updated_at) VALUES ('*','duplicate')").run()).toThrow(/UNIQUE/);
  });
  it("keeps admin reads, edits and deletes inside the acting workspace", async () => {
    const h = setup(), app = await admin(h);
    h.relay.saveGrant("node:foreign", { rpm: 7 }, "B");
    const status = await app.inject({ method: "GET", url: "/api/llm/relay-admin/status" });
    expect(status.json().callers).toEqual([]);
    const updated = await app.inject({ method: "PUT", url: "/api/llm/relay-admin/grants", payload: { caller: "node:foreign", rpm: 99 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().grant).toMatchObject({ workspaceId: "A", rpm: 99 });
    expect(h.relay.grantOf("node:foreign", "B").rpm).toBe(7);
    expect((await app.inject({ method: "DELETE", url: "/api/llm/relay-admin/grants?caller=node%3Aforeign" })).json()).toEqual({ deleted: true });
    expect(h.relay.grantOf("node:foreign", "B").rpm).toBe(7);
    const foreignStatus = await app.inject({ method: "GET", url: "/api/llm/relay-admin/status", headers: { "x-fixture-workspace": "B" } });
    expect(foreignStatus.json().callers[0].grant).toMatchObject({ workspaceId: "B", rpm: 7 });
    expect((await app.inject({ method: "PUT", url: "/api/llm/relay-admin/grants", headers: { "x-fixture-kind": "apikey" },
      payload: { caller: "*", enabled: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/llm/relay-admin/status", headers: { "x-fixture-kind": "apikey" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/llm/relay-admin/grants", payload: { caller: "agent:hermes/Hermes 1", rpm: 5 } })).statusCode).toBe(200);
  });

  it("stores independent default lists and duplicate agent names, including NULL legacy scope", async () => {
    const h = setup();
    h.relay.saveGrant("*", { models: ["fast"] }, "A");
    h.relay.saveGrant("*", { models: ["smart"] }, "B");
    h.relay.saveGrant("*", { enabled: false });
    h.relay.saveGrant("*", { enabled: true });
    for (const scope of ["A", "B"]) h.relay.saveGrant(caller(scope).caller, { models: [] }, scope);
    expect((await h.relay.listModels(caller("A"))).data.map((model) => model.id)).toEqual(["fast"]);
    expect((await h.relay.listModels(caller("B"))).data.map((model) => model.id)).toEqual(["smart"]);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM llm_relay_grants WHERE caller='*' AND workspace_id IS NULL").get()).toEqual({ n: 1 });
    expect(h.relay.deleteGrant(caller("A").caller, "A")).toBe(true);
    expect(h.relay.grantOf(caller("B").caller, "B").models).toEqual(["smart"]);
  });

  it("separates rate windows, usage totals and refusal history for the same agent name", async () => {
    const h = setup();
    for (const scope of ["A", "B"]) h.relay.saveGrant(caller(scope).caller, { rpm: 1 }, scope);
    await h.relay.relay("chat/completions", caller("A"), chat);
    await expect(h.relay.relay("chat/completions", caller("A"), chat)).rejects.toMatchObject({ code: "RELAY_RATE_LIMITED" });
    await h.relay.relay("chat/completions", caller("B"), chat);
    expect((await h.relay.status("A")).callers[0]).toMatchObject({ calls: 1, refused: 1, lastRefusal: "RELAY_RATE_LIMITED" });
    expect((await h.relay.status("B")).callers[0]).toMatchObject({ calls: 1, refused: 0, lastRefusal: null });
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not charge another workspace's completed calls against a caller's daily cap", async () => {
    const h = setup();
    h.sqlite.prepare(`INSERT INTO llm_relay_usage(id,caller,workspace_id,model,cost_usd,status,created_at)
      VALUES ('foreign-cost',?,'A','fast',5,'ok',?)`).run(caller("A").caller, h.clock().toISOString());
    expect(h.relay.spentToday(caller("A").caller, "A")).toBe(5);
    expect(h.relay.spentToday(caller("B").caller, "B")).toBe(0);
    await expect(h.relay.relay("chat/completions", caller("A"), chat)).rejects.toMatchObject({ code: "RELAY_BUDGET_EXCEEDED" });
    expect((await h.relay.relay("chat/completions", caller("B"), chat)).status).toBe(200);
  });
});
