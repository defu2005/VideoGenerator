import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fleetBundlePayload, type FleetBundle } from "@vg/shared";
import { installFleetFiles, mergeFleetConfig, syncFleetOnce, syncPath } from "../src/sync.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function home() { const root = mkdtempSync(join(tmpdir(), "vg-sync123-")); roots.push(root); return root; }
function bundle(version = 1): FleetBundle {
  const data: Omit<FleetBundle, "hash" | "bundleVersion"> = {
    files: [{ path: "vg-test/SKILL.md", content: "---\nname: vg-test\ndescription: test\n---\nRead state." }],
    configPatch: { model: { provider: "custom:fleet", default: "fixture", base_url: "${VG_API_URL}/api/llm/relay/v1" }, providers: { fleet: { api: "${VG_API_URL}/api/llm/relay/v1", api_mode: "chat_completions", api_key: "${VG_API_KEY}" } }, mcp_servers: { "video-agent": { url: "${VG_MCP_URL}", headers: { Authorization: "Bearer ${VG_API_KEY}" } } }, skills: { external_dirs: ["/opt/data/vg-skills"] }, memory: { memory_enabled: true } },
    hermesVersion: "0.23.1", toolHash: "a".repeat(64), skillVersions: { "vg-test": version },
    cron: [{ name: "vg-supervise", schedule: "every 15m", prompt: "Run the vg-supervise skill", skill: "vg-supervise", command: 'hermes cron create "every 15m" "Run the vg-supervise skill" --skill vg-supervise --name vg-supervise' }],
  };
  return { ...data, bundleVersion: version, hash: createHash("sha256").update(fleetBundlePayload(data)).digest("hex") };
}
it("replaces only hub-owned files and rejects traversal and symlinks", () => {
  const root = home(), outside = home();
  mkdirSync(join(root, "skills/local"), { recursive: true }); writeFileSync(join(root, "skills/local/SKILL.md"), "keep");
  installFleetFiles(root, bundle().files);
  installFleetFiles(root, [{ path: "new/SKILL.md", content: "new" }]);
  expect(existsSync(join(root, "vg-skills/vg-test/SKILL.md"))).toBe(false);
  expect(readFileSync(join(root, "skills/local/SKILL.md"), "utf8")).toBe("keep");
  expect(() => installFleetFiles(root, [{ path: "../escape.md", content: "bad" }])).toThrow();
  expect(() => syncPath(root, "../outside")).toThrow("SYNC_PATH_REJECTED");
  symlinkSync(outside, join(root, "linked"), "junction");
  expect(() => syncPath(root, "linked/file.md")).toThrow("SYNC_SYMLINK_REJECTED");
});
it("merges managed YAML leaves, keeps local settings/comments/external dirs, and writes a backup and reload marker", () => {
  const root = home();
  const original = '# user comment\nmodel:\n  provider: old\n  temperature: 0.5\ntelegram:\n  enabled: false\nskills:\n  external_dirs: ["/local/skills"]\nproviders:\n  fleet:\n    request_timeout_seconds: 120\nmcp_servers:\n  video-agent:\n    command: node\n    args: [old-mcp.js]\n    env: {VG_TOOL_SOURCE: operator}\n    transport: stdio\n  unrelated:\n    command: keep-local-server\n';
  writeFileSync(join(root, "config.yaml"), original);
  const first = mergeFleetConfig(root, bundle().configPatch);
  expect(first.changed).toBe(true);
  expect(readFileSync(join(root, "config.yaml.vg-bak"), "utf8")).toBe(original);
  const text = readFileSync(join(root, "config.yaml"), "utf8"), parsed = parse(text);
  expect(text).toContain("# user comment");
  expect(parsed).toMatchObject({ model: { temperature: 0.5, provider: "custom:fleet" }, telegram: { enabled: false }, providers: { fleet: { request_timeout_seconds: 120, api_key: "${VG_API_KEY}" } } });
  expect(parsed.skills.external_dirs).toEqual(["/local/skills", join(root, "vg-skills")]);
  expect(parsed.mcp_servers["video-agent"]).toEqual({ url: "${VG_MCP_URL}", headers: { Authorization: "Bearer ${VG_API_KEY}" } });
  expect(parsed.mcp_servers.unrelated.command).toBe("keep-local-server");
  expect(existsSync(join(root, "vg-sync/reload-needed"))).toBe(true);
  expect(mergeFleetConfig(root, bundle().configPatch, first.managed).changed).toBe(false);
  expect(() => mergeFleetConfig(root, { ...bundle().configPatch, terminal: { command: "unsafe" } } as never)).toThrow();
});

it("clears a stale local model when relay policy has no eligible default while retaining the relay provider", () => {
  const root = home();
  writeFileSync(join(root, "config.yaml"), "model:\n  default: stale-direct-model\n  provider: direct-provider\n");
  const patch = bundle().configPatch;
  patch.model.default = "";
  mergeFleetConfig(root, patch);
  const config = parse(readFileSync(join(root, "config.yaml"), "utf8"));
  expect(config.model.default).toBe("");
  expect(config.model.provider).toBe("custom:fleet");
  expect(config.model.base_url).toBe("${VG_API_URL}/api/llm/relay/v1");
  expect(config.providers.fleet.api_key).toBe("${VG_API_KEY}");
});
it("syncs without tokens, pushes only changes, uses the pre-pull parent, and never transmits local secrets/memory", async () => {
  const root = home();
  for (const name of ["memories", "sessions", "skills/video-local", "cron"]) mkdirSync(join(root, name), { recursive: true });
  const protectedFiles = { ".env": "FAKE_KEY=private-fixture-value", "auth.json": '{"private":"fixture-value"}', "memories/MEMORY.md": "private memory", "sessions/one.json": "private session" };
  for (const [path, content] of Object.entries(protectedFiles)) writeFileSync(join(root, path), content);
  const skill = "---\nname: video-local\ndescription: Read projects\n---\nRead list_projects.";
  writeFileSync(join(root, "skills/video-local/SKILL.md"), skill);
  writeFileSync(join(root, "skills/video-local/schema.json"), '{"title":"Safe fixture"}');
  writeFileSync(join(root, "skills/video-local/auth.json"), '{"private":"must-not-read-or-send"}');
  let current = bundle(); current.skillVersions = { "video-local": 1 }; current.hash = createHash("sha256").update(fleetBundlePayload(current)).digest("hex");
  const bodies: Array<{ path: string; body: any }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    expect(new Headers(init?.headers).get("x-api-key")).toBe("machine-fixture-key");
    if (init?.body) bodies.push({ path, body: JSON.parse(String(init.body)) });
    return Response.json(path.endsWith("/bundle") ? current : { ok: true });
  }) as typeof fetch;
  const options = { home: root, apiUrl: "http://hub.test", apiKey: "machine-fixture-key", hermesVersion: "0.23.1", fetchImpl };
  expect(await syncFleetOnce(options)).toMatchObject({ ok: true, pushed: 1, reload: true });
  expect(await syncFleetOnce(options)).toMatchObject({ ok: true, pushed: 0, reload: false });
  current.skillVersions = { "video-local": 2 }; current.bundleVersion = 2; current.hash = createHash("sha256").update(fleetBundlePayload(current)).digest("hex");
  writeFileSync(join(root, "skills/video-local/SKILL.md"), `${skill}\nChanged locally.`);
  expect(await syncFleetOnce(options)).toMatchObject({ ok: true, pushed: 1 });
  const drafts = bodies.filter((entry) => entry.path.endsWith("/drafts"));
  expect(drafts).toHaveLength(2); expect(drafts[1]!.body.parentVersion).toBe(1);
  expect(drafts[0]!.body.files).toEqual({ "schema.json": '{"title":"Safe fixture"}' });
  expect(bodies.at(-1)!.body).toMatchObject({ bundleVersion: 2, skillsHash: expect.stringMatching(/^[a-f0-9]{64}$/), toolHash: "a".repeat(64), pendingCron: [expect.stringContaining("hermes cron create")] });
  for (const [path, content] of Object.entries(protectedFiles)) { expect(readFileSync(join(root, path), "utf8")).toBe(content); expect(JSON.stringify(bodies)).not.toContain(content); }
  const before = readFileSync(join(root, "vg-skills/vg-test/SKILL.md"), "utf8");
  const logs: string[] = [];
  expect(await syncFleetOnce({ ...options, log: (s) => logs.push(s), fetchImpl: vi.fn(async () => { throw new Error("machine-fixture-key"); }) as typeof fetch })).toMatchObject({ ok: false });
  expect(readFileSync(join(root, "vg-skills/vg-test/SKILL.md"), "utf8")).toBe(before);
  expect(logs.join()).not.toContain("machine-fixture-key");
});

it("never puts its own machine key in a pushed skill or error log", async () => {
  const root = home(), key = "machine-private-fixture-key";
  mkdirSync(join(root, "skills/video-private"), { recursive: true });
  writeFileSync(join(root, "skills/video-private/SKILL.md"), `---\nname: video-private\ndescription: fixture\n---\n${key}`);
  const sent: string[] = [], logs: string[] = [];
  const result = await syncFleetOnce({ home: root, apiUrl: "http://hub.test", apiKey: key, hermesVersion: "0.23.1", log: (line) => logs.push(line), fetchImpl: async (url, init) => {
    if (init?.body) sent.push(String(init.body));
    return Response.json(String(url).endsWith("/bundle") ? bundle() : { ok: true });
  } });
  expect(result).toMatchObject({ ok: false, code: "SYNC_SECRET_REJECTED" });
  expect(sent.join()).not.toContain(key); expect(logs.join()).not.toContain(key);
});

it("refuses a corrupt bundle before writing its configuration", async () => {
  const root = home(), original = "telegram:\n  enabled: false\n"; writeFileSync(join(root, "config.yaml"), original);
  const bad = { ...bundle(), hash: "0".repeat(64) };
  const result = await syncFleetOnce({ home: root, apiUrl: "http://hub.test", apiKey: "fixture", hermesVersion: "0.23.1", fetchImpl: vi.fn(async (url) => Response.json(String(url).endsWith("/bundle") ? bad : { ok: true })) as typeof fetch });
  expect(result).toMatchObject({ ok: false, code: "SYNC_HASH_MISMATCH" });
  expect(readFileSync(join(root, "config.yaml"), "utf8")).toBe(original);
});
