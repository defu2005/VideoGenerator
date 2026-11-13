import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STYLE_PRESETS, stylePackTokens, TOOL_GRANTS } from "@vg/shared";
import { registerStyleRoutes, type StyleRouteDeps } from "../src/api/style.js";
import { findRule } from "../src/auth/routePermissions.js";
import { toolAction } from "../src/auth/toolActions.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { AppError } from "../src/lib/errors.js";
import { styleToolDefs } from "../src/style/toolDefs.js";
import { StyleService } from "../src/style/service.js";

const open: Array<{ close: () => void }> = [];
const dirs: string[] = [];
const now = "2026-11-13T03:00:00.000Z";

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memory() {
  const opened = openDatabase(":memory:");
  open.push({ close: () => opened.sqlite.close() });
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}

function profile(sqlite: ReturnType<typeof memory>, name: string, brief: object = {}, color = "#3B82F6"): string {
  const id = randomUUID();
  sqlite.prepare(
    "INSERT INTO profiles (id, name, default_brief, guidelines, color, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?)",
  ).run(id, name, JSON.stringify(brief), color, now, now);
  return id;
}

function build(deps: StyleRouteDeps = {}) {
  const sqlite = memory();
  const dataDir = mkdtempSync(join(tmpdir(), "vg-style-api-"));
  dirs.push(dataDir);
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const v = error as Error & { validation?: unknown };
    if (v.validation !== undefined || error.name === "ZodError") return reply.code(400).send({ error: { code: "VALIDATION", message: error.message } });
    throw error;
  });
  registerStyleRoutes(app, sqlite, { config: { DATA_DIR: dataDir } as never, ...deps });
  return { app, sqlite, dataDir };
}

const versionCount = (sqlite: ReturnType<typeof memory>, profileId: string) =>
  (sqlite.prepare("SELECT COUNT(*) AS n FROM style_packs WHERE id = (SELECT style_pack_id FROM profiles WHERE id = ?)").get(profileId) as { n: number }).n;

describe("style pack create and edit routes", () => {
  it("each create route saves a new version and returns the resolved style", async () => {
    const { app, sqlite } = build();
    const id = profile(sqlite, "Kênh A");
    new StyleService(sqlite).packForProfile(id);
    expect(versionCount(sqlite, id)).toBe(1);
    const base = `/api/profiles/${id}/style-pack`;

    const preset = STYLE_PRESETS.find((item) => item.id === "paper")!;
    const fromPreset = await app.inject({ method: "POST", url: `${base}/from-preset`, payload: { presetId: preset.id } });
    expect(fromPreset.statusCode).toBe(200);
    expect(fromPreset.json().pack.version).toBe(2);
    expect(fromPreset.json().pack.origin).toMatchObject({ kind: "preset", presetId: "paper" });
    expect(fromPreset.json().style.issues.contrast).toEqual([]);
    expect(fromPreset.json().style.fingerprint).toBeTruthy();

    const fromChoices = await app.inject({ method: "POST", url: `${base}/from-choices`, payload: { brand: "#7C3AED", mode: "dark", energy: "lively" } });
    expect(fromChoices.statusCode).toBe(200);
    expect(fromChoices.json().pack.version).toBe(3);
    expect(fromChoices.json().pack.origin.kind).toBe("choices");

    const fromBrand = await app.inject({ method: "POST", url: `${base}/from-brand`, payload: { colors: ["#0E7490", "#F59E0B"] } });
    expect(fromBrand.statusCode).toBe(200);
    expect(fromBrand.json().pack.version).toBe(4);
    expect(fromBrand.json().pack.origin.kind).toBe("brand");
    expect(fromBrand.json().tokens.palette.brand).toBe("#0E7490");
    expect(versionCount(sqlite, id)).toBe(4);

    expect((await app.inject({ method: "POST", url: `${base}/from-preset`, payload: { presetId: "khong-co" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${base}/from-brand`, payload: { colors: ["xanh"] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/profiles/${randomUUID()}/style-pack/from-preset`, payload: { presetId: "paper" } })).statusCode).toBe(404);
  });

  it("a manual patch and a revert both make new versions and never delete rows", async () => {
    const { app, sqlite } = build();
    const id = profile(sqlite, "Kênh B");
    const first = new StyleService(sqlite).packForProfile(id)!;
    const base = `/api/profiles/${id}/style-pack`;

    const patched = await app.inject({ method: "PUT", url: base, payload: { patch: { layout: { density: 0.7 }, rhythm: { paceScale: 0.8 } }, reason: "Nhịp nhanh hơn" } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().pack.version).toBe(2);
    expect(patched.json().pack.origin).toMatchObject({ kind: "manual", note: "Nhịp nhanh hơn" });
    expect(patched.json().tokens.rhythm.paceScale).toBe(0.8);
    // The patch merges: the colours stay.
    expect(patched.json().tokens.palette).toEqual(stylePackTokens(first).palette);

    const missingReason = await app.inject({ method: "PUT", url: base, payload: { patch: { layout: { density: 0.9 } } } });
    expect(missingReason.statusCode).toBe(400);

    const reverted = await app.inject({ method: "POST", url: `${base}/revert`, payload: { version: 1 } });
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json().pack.version).toBe(3);
    expect(reverted.json().tokens).toEqual(stylePackTokens(first));
    expect(versionCount(sqlite, id)).toBe(3);

    const noVersion = await app.inject({ method: "POST", url: `${base}/revert`, payload: { version: 9 } });
    expect(noVersion.statusCode).toBe(404);

    const versions = await app.inject({ method: "GET", url: `${base}/versions` });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().versions.map((item: { version: number }) => item.version)).toEqual([3, 2, 1]);
    expect(versions.json().versions[0].current).toBe(true);
    expect(versions.json().versions[2].current).toBe(false);
  });

  it("refuses a pack with a blocking contrast issue (400, Vietnamese) and saves nothing", async () => {
    const { app, sqlite } = build({
      contrastOf: () => [{ pair: "text/bg", ratio: 2.1, min: 4.5 }],
    });
    const id = profile(sqlite, "Kênh C");
    new StyleService(sqlite).packForProfile(id);
    const response = await app.inject({ method: "PUT", url: `/api/profiles/${id}/style-pack`, payload: { patch: { palette: { brand: "#CCCCCC" } }, reason: "Thử" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("STYLE_CONTRAST");
    expect(response.json().error.message).toContain("khó đọc");
    expect(versionCount(sqlite, id)).toBe(1);
    const preset = await app.inject({ method: "POST", url: `/api/profiles/${id}/style-pack/from-preset`, payload: { presetId: "paper" } });
    expect(preset.statusCode).toBe(400);
    expect(versionCount(sqlite, id)).toBe(1);
  });

  it("flags a channel whose new look matches another channel", async () => {
    const { app, sqlite } = build();
    const a = profile(sqlite, "Kênh một");
    const b = profile(sqlite, "Kênh hai");
    new StyleService(sqlite).packForProfile(a);
    new StyleService(sqlite).packForProfile(b);
    const first = await app.inject({ method: "POST", url: `/api/profiles/${a}/style-pack/from-preset`, payload: { presetId: "newsroom" } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: `/api/profiles/${b}/style-pack/from-preset`, payload: { presetId: "newsroom" } });
    expect(second.json().similar).toEqual([expect.objectContaining({ profileId: a, name: "Kênh một" })]);
    expect(second.json().similar[0].score).toBeGreaterThanOrEqual(0.8);
  });
});

describe("style pack proposal", () => {
  it("ECO makes no model call and returns a preset no other channel uses", async () => {
    const generate = vi.fn();
    const { app, sqlite } = build({ generate });
    const service = new StyleService(sqlite);
    const other = profile(sqlite, "Kênh khác");
    service.packForProfile(other);
    const used = service.packForProfile(other)!.origin.presetId;
    const eco = profile(sqlite, "Kênh ECO", { budget: { mode: "ECO" } });
    service.packForProfile(eco);
    sqlite.prepare("UPDATE style_packs SET origin = ? WHERE id = ?").run(JSON.stringify({ kind: "preset", presetId: used }), eco);

    const response = await app.inject({ method: "POST", url: `/api/profiles/${eco}/style-pack/propose`, payload: { note: "Sáng và gọn" } });
    expect(response.statusCode).toBe(200);
    expect(generate).not.toHaveBeenCalled();
    const draft = response.json();
    expect(draft.source).toBe("preset");
    expect(draft.message).toContain("ECO");
    expect(draft.pack.origin.kind).toBe("preset");
    expect(draft.pack.origin.presetId).not.toBe(used);
    expect(draft.dropped).toEqual([]);
    // A draft is never saved.
    expect(versionCount(sqlite, eco)).toBe(1);
  });

  it("validates the model's proposal, returns what was dropped and saves nothing", async () => {
    const generate = vi.fn(async () => ({
      palette: { mode: "light", brand: "#F8FAFC", accent: "#0E7490" },
      type: { display: { family: "be-vietnam-pro", weight: 800 } },
      layout: { family: "poster" },
      hologram: { shine: 9 },
    }));
    const { app, sqlite } = build({ generate });
    const other = profile(sqlite, "Kênh đối chiếu");
    new StyleService(sqlite).packForProfile(other);
    const id = profile(sqlite, "Kênh LLM", { budget: { mode: "BALANCED" } }, "#0E7490");
    new StyleService(sqlite).packForProfile(id);

    const response = await app.inject({ method: "POST", url: `/api/profiles/${id}/style-pack/propose`, payload: { note: "Sạch, hơi hiện đại" } });
    expect(response.statusCode).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const built = generate.mock.calls[0]![0] as { system: string; prompt: string };
    const prompt = JSON.parse(built.prompt);
    expect(prompt.note).toBe("Sạch, hơi hiện đại");
    expect(prompt.brandColors).toEqual(["#0E7490"]);
    expect(prompt.others).toHaveLength(1);
    expect(prompt.others[0].channel).toBe("Kênh đối chiếu");
    expect(prompt.others[0].fingerprint).toBeTruthy();
    expect(prompt).toHaveProperty("niche");
    expect(prompt).toHaveProperty("language");

    const draft = response.json();
    expect(draft.source).toBe("llm");
    expect(draft.pack.origin.kind).toBe("llm");
    expect(draft.tokens.layout.family).toBe("poster");
    expect(draft.dropped).toEqual(expect.arrayContaining([expect.stringContaining("hologram")]));
    expect(versionCount(sqlite, id)).toBe(1);
  });
});

describe("style pack preview", () => {
  it("renders three frames, caches by fingerprint + aspect, and never fails on a render error", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const renderFrame = vi.fn(async () => png);
    const { app, sqlite, dataDir } = build({ renderFrame });
    const id = profile(sqlite, "Kênh xem thử", { aspectRatio: "9:16" });
    new StyleService(sqlite).packForProfile(id);
    const url = `/api/profiles/${id}/style-pack/preview`;

    const first = await app.inject({ method: "POST", url, payload: {} });
    expect(first.statusCode).toBe(200);
    expect(first.json().aspect).toBe("9:16");
    expect(first.json().frames.map((frame: { id: string }) => frame.id)).toEqual(["title", "kinetic", "list"]);
    expect(first.json().frames[0].dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(first.json().cached).toBe(false);
    expect(renderFrame).toHaveBeenCalledTimes(3);
    expect(first.json().style.color.bg).toBeTruthy();

    const second = await app.inject({ method: "POST", url, payload: {} });
    expect(second.json().cached).toBe(true);
    expect(renderFrame).toHaveBeenCalledTimes(3);
    expect(dataDir).toBeTruthy();

    const failing = build({ renderFrame: async () => { throw new Error("HyperFrames hỏng"); } });
    const other = profile(failing.sqlite, "Kênh lỗi");
    new StyleService(failing.sqlite).packForProfile(other);
    const swatch = await failing.app.inject({ method: "POST", url: `/api/profiles/${other}/style-pack/preview`, payload: {} });
    expect(swatch.statusCode).toBe(200);
    expect(swatch.json().frames).toEqual([]);
    expect(swatch.json().warning).toContain("HyperFrames hỏng");
    expect(swatch.json().style.fingerprint).toBeTruthy();
  });
});

describe("style pack permissions and tools", () => {
  it("maps reads to profile reads, preview to a read and edits to channel.manage", () => {
    const rule = (method: string, template: string) => findRule(method, template)?.action;
    expect(rule("GET", "/api/profiles/:id/style-pack")).toBe("channel.read");
    expect(rule("GET", "/api/profiles/:id/style-pack/versions")).toBe("channel.read");
    expect(rule("POST", "/api/profiles/:id/style-pack/preview")).toBe("channel.read");
    for (const [method, template] of [
      ["PUT", "/api/profiles/:id/style-pack"],
      ["POST", "/api/profiles/:id/style-pack/from-preset"],
      ["POST", "/api/profiles/:id/style-pack/from-choices"],
      ["POST", "/api/profiles/:id/style-pack/from-brand"],
      ["POST", "/api/profiles/:id/style-pack/propose"],
      ["POST", "/api/profiles/:id/style-pack/revert"],
    ] as const) {
      expect(rule(method, template)).toBe("channel.manage");
    }
  });

  it("registers the three tools with the right risk and an always-pending grant for set_style_pack", () => {
    const risks = Object.fromEntries(styleToolDefs.map((tool) => [tool.name, tool.risk]));
    expect(risks).toEqual({ get_style_pack: "read", propose_style_pack: "safe", set_style_pack: "confirm" });
    expect(Object.hasOwn(TOOL_GRANTS, "set_style_pack")).toBe(true);
    expect(TOOL_GRANTS.set_style_pack).toBeNull();
    for (const tool of styleToolDefs) expect(toolAction(tool.name)).toBeTruthy();
  });

  it("set_style_pack changes the pack through the same checks as the route", async () => {
    const sqlite = memory();
    const id = profile(sqlite, "Kênh công cụ");
    new StyleService(sqlite).packForProfile(id);
    const set = styleToolDefs.find((tool) => tool.name === "set_style_pack")!;
    const get = styleToolDefs.find((tool) => tool.name === "get_style_pack")!;
    const ctx = { sqlite } as never;
    const saved = await set.execute({ profileId: id, presetId: "paper", reason: "Thử mẫu giấy" }, ctx) as { pack: { version: number } };
    expect(saved.pack.version).toBe(2);
    await expect(set.execute({ profileId: id, presetId: "paper", pack: { layout: { density: 0.8 } }, reason: "x" }, ctx)).rejects.toThrow();
    const read = await get.execute({ profileId: id }, ctx) as { pack: { version: number }; versions: unknown[] };
    expect(read.pack.version).toBe(2);
    expect(read.versions).toHaveLength(2);
  });
});
