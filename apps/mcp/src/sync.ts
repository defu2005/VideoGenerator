#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, homedir } from "node:os";
import { parseDocument } from "yaml";
import { FleetBundleSchema, FleetConfigPatchSchema, FleetFileSchema, fleetBundlePayload, redactExportText, type FleetBundle } from "@vg/shared";
import { pollAgentEventsOnce, pollInboxOnce, type InboxPeek, type PolledEvent } from "./eventPoller.js";

type SyncState = { bundleVersion: number; hash: string; skillsHash: string; toolHash: string; pushed: Record<string, string>; managed: string[][]; activeVersions: Record<string, number> };
const emptyState = (): SyncState => ({ bundleVersion: 0, hash: "", skillsHash: "", toolHash: "", pushed: {}, managed: [], activeVersions: {} });
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Reject links in every existing component, including the configured home, before reading/writing. */
export function syncPath(home: string, name: string): string {
  const base = resolve(home), path = resolve(base, name), rel = relative(base, path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("SYNC_PATH_REJECTED");
  let part = base;
  const refuseLink = (path: string) => {
    try {
      if (lstatSync(path).isSymbolicLink()) {
        // WSL/Docker use an atomic symlink pointer to an immutable managed generation.
        // No other symlink, including a pointer outside vg-sync, is followed.
        const target = resolve(dirname(path), readlinkSync(path));
        const targetName = relative(base, target);
        if (process.platform !== "win32" && path === join(base, "vg-skills") && /^vg-sync\/generation-[0-9a-f-]{36}$/.test(targetName)) {
          const checked = syncPath(base, targetName);
          if (lstatSync(checked).isDirectory()) return;
        }
        throw new Error("SYNC_SYMLINK_REJECTED");
      }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  };
  // The home itself and all ancestors must resolve to the expected directory, not a symlink.
  for (let ancestor = base; ; ancestor = dirname(ancestor)) {
    refuseLink(ancestor);
    if (dirname(ancestor) === ancestor) break;
  }
  for (const item of rel.split(sep).filter(Boolean)) {
    part = join(part, item);
    refuseLink(part);
  }
  return path;
}
function atomicText(home: string, path: string, content: string) {
  const target = syncPath(home, path), temp = syncPath(home, `${path}.vg-${randomUUID()}.tmp`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { renameSync(temp, target); } finally { if (existsSync(temp)) rmSync(temp); }
}
export function installFleetFiles(home: string, files: FleetBundle["files"]) {
  const validated = files.map((file) => FleetFileSchema.parse(file));
  if (new Set(validated.map((file) => file.path)).size !== validated.length) throw new Error("SYNC_DUPLICATE_PATH");
  const stageName = `vg-sync/${process.platform === "win32" ? "stage" : "generation"}-${randomUUID()}`, previousName = `vg-sync/previous-${randomUUID()}`;
  const stage = syncPath(home, stageName), previous = syncPath(home, previousName), target = syncPath(home, "vg-skills");
  mkdirSync(stage, { recursive: true });
  let moved = false;
  let installed = false;
  try {
    for (const file of validated) {
      const path = syncPath(home, `${stageName}/${file.path}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content, { encoding: "utf8", mode: 0o444, flag: "wx" });
    }
    if (process.platform !== "win32") {
      const pointer = syncPath(home, `vg-sync/pointer-${randomUUID()}`);
      symlinkSync(stage, pointer, "dir");
      // Existing pre-sidecar directories need a one-time migration. Routine generation
      // changes replace a symlink with rename(2), so readers never see an absent folder.
      if (existsSync(target) && !lstatSync(target).isSymbolicLink()) { renameSync(target, previous); moved = true; }
      try { renameSync(pointer, target); installed = true; }
      catch (error) { if (moved) renameSync(previous, target); if (existsSync(pointer)) rmSync(pointer); throw error; }
      // Keep old generations: a gateway may still be reading one. They are managed state,
      // not active skills, and disappear with the instance's volume when it is removed.
      return;
    }
    if (existsSync(target)) { renameSync(target, previous); moved = true; }
    try { renameSync(stage, target); installed = true; }
    catch (error) { if (moved) renameSync(previous, target); throw error; }
    if (moved) rmSync(syncPath(home, previousName), { recursive: true, force: true });
  } finally { if (!installed && existsSync(stage)) rmSync(syncPath(home, stageName), { recursive: true, force: true }); }
}
export function mergeFleetConfig(home: string, rawPatch: FleetBundle["configPatch"], previousManaged: string[][] = []) {
  const patch = FleetConfigPatchSchema.parse(rawPatch);
  const path = syncPath(home, "config.yaml");
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const doc = parseDocument(before || "{}\n", { uniqueKeys: true });
  if (doc.errors.length) throw new Error("SYNC_CONFIG_INVALID");
  const fields: Array<[string[], unknown]> = [
    ...Object.entries(patch.model).map(([key, value]) => [["model", key], value] as [string[], unknown]),
    ...Object.entries(patch.providers).flatMap(([name, provider]) => Object.entries(provider).map(([key, value]) => [["providers", name, key], value] as [string[], unknown])),
    [["mcp_servers", "video-agent", "url"], patch.mcp_servers["video-agent"].url],
    [["mcp_servers", "video-agent", "headers", "Authorization"], patch.mcp_servers["video-agent"].headers.Authorization],
    [["memory", "memory_enabled"], patch.memory.memory_enabled],
  ];
  const managed = fields.map(([key]) => key);
  let changed = false;
  // This entry is now managed as HTTP. Leaving stdio fields in place makes Hermes
  // choose the old process transport instead of the newly synced remote URL.
  for (const key of ["command", "args", "env", "transport"]) {
    const path = ["mcp_servers", "video-agent", key];
    if (doc.hasIn(path) && doc.deleteIn(path)) changed = true;
  }
  // Only remove old keys that belong to a previously managed named provider. Never accept
  // arbitrary paths from the state file (which may have been modified locally).
  for (const key of previousManaged) {
    if (key.length === 3 && key[0] === "providers" && /^[a-zA-Z0-9_-]{1,60}$/.test(key[1] ?? "")
      && ["api", "api_mode", "api_key"].includes(key[2] ?? "") && !managed.some((next) => JSON.stringify(next) === JSON.stringify(key))) {
      if (doc.hasIn(key) && doc.deleteIn(key)) changed = true;
    }
  }
  for (const [key, value] of fields) if (doc.getIn(key) !== value) { doc.setIn(key, value); changed = true; }
  const external = doc.getIn(["skills", "external_dirs"]);
  const currentExternal = external === undefined ? [] : (external as { toJSON?: () => unknown }).toJSON?.();
  if (!Array.isArray(currentExternal) || currentExternal.some((item) => typeof item !== "string")) throw new Error("SYNC_EXTERNAL_DIRS_INVALID");
  const directory = syncPath(home, "vg-skills");
  if (!currentExternal.includes(directory)) { doc.setIn(["skills", "external_dirs"], [...currentExternal, directory]); changed = true; }
  const after = doc.toString();
  if (changed || after !== before && before === "") {
    // Backup remains local. Neither this file nor any other part of config is ever sent to the hub.
    atomicText(home, "config.yaml.vg-bak", before);
    atomicText(home, "config.yaml", after);
    atomicText(home, "vg-sync/reload-needed", "Chạy /reload-mcp hoặc khởi động lại Hermes gateway.\n");
  }
  return { changed, managed };
}
function readState(home: string): SyncState {
  const path = syncPath(home, "vg-sync/state.json");
  if (!existsSync(path)) return emptyState();
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SyncState>;
  if (!Number.isInteger(raw.bundleVersion) || !raw.pushed || typeof raw.pushed !== "object" || !Array.isArray(raw.managed)) throw new Error("SYNC_STATE_INVALID");
  return { ...emptyState(), ...raw } as SyncState;
}
function cronCommands(home: string, bundle: FleetBundle): string[] {
  const path = syncPath(home, "cron/jobs.json");
  let names: string[] = [];
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      const jobs = Array.isArray(data) ? data : data.jobs;
      if (Array.isArray(jobs)) names = jobs.flatMap((job: { name?: unknown }) => typeof job.name === "string" ? [job.name] : []);
    } catch { /* Unknown cron format: show the command, never edit Hermes's job store. */ }
  }
  return bundle.cron.filter((job) => !names.includes(job.name)).map((job) => job.command);
}
function localSkills(home: string) {
  const dir = syncPath(home, "skills");
  const result: Array<{ name: string; markdown: string; files: Record<string, string>; hash: string }> = [];
  function scan(relativePath: string, depth: number) {
    if (depth > 5) return;
    const root = syncPath(home, relativePath);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!/^[a-zA-Z0-9_-]+$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const relativeDir = `${relativePath}/${entry.name}`, folder = syncPath(home, relativeDir);
      const skillPath = syncPath(home, `${relativeDir}/SKILL.md`);
      if (!existsSync(skillPath)) { scan(relativeDir, depth + 1); continue; }
      if (lstatSync(skillPath).size > 12_000) continue;
      const markdown = readFileSync(skillPath, "utf8");
      if (redactExportText(markdown) !== markdown) continue;
      const name = /^name:\s*([a-z0-9][a-z0-9-]{1,79})\s*$/m.exec(markdown)?.[1];
      if (!name) continue;
      const files: Record<string, string> = {};
      let bytes = 0;
      function support(relativeSupport: string, level: number) {
        if (level > 3) return;
        for (const file of readdirSync(syncPath(home, `${relativeDir}/${relativeSupport}`), { withFileTypes: true })) {
          if (file.name.startsWith(".") || file.name.toLowerCase() === "auth.json" || file.isSymbolicLink()) continue;
          const rel = relativeSupport ? `${relativeSupport}/${file.name}` : file.name;
          if (file.isDirectory() && !["memories", "sessions"].includes(file.name) && /^[a-zA-Z0-9_-]+$/.test(file.name)) { support(rel, level + 1); continue; }
          if (!file.isFile() || rel === "SKILL.md" || !/\.(md|txt|json|yaml|yml|csv|tsv)$/.test(file.name)) continue;
          const path = syncPath(home, `${relativeDir}/${rel}`), size = lstatSync(path).size;
          if (size > 256 * 1024 || bytes + size > 1_048_576) continue;
          const content = readFileSync(path, "utf8");
          if (!FleetFileSchema.safeParse({ path: `${name}/${rel}`, content }).success || redactExportText(content) !== content) continue;
          files[rel] = content; bytes += size;
        }
      }
      support("", 0);
      result.push({ name, markdown, files, hash: sha256(JSON.stringify({ markdown, files })) });
    }
  }
  if (existsSync(dir)) scan("skills", 0);
  return result;
}
export type SyncOptions = {
  home: string; apiUrl: string; apiKey: string; instance?: string; environment?: string; hermesVersion: string;
  fetchImpl?: typeof fetch; log?: (text: string) => void;
  secretValues?: readonly string[];
};
/** Shared by the sync loop and the event poller: same auth, secret check and error codes. */
function makeApi(options: SyncOptions, fetchImpl: typeof fetch) {
  return async function api(path: string, body?: unknown): Promise<unknown> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized && [options.apiKey, ...(options.secretValues ?? [])].some((value) => value && serialized.includes(value))) throw new Error("SYNC_SECRET_REJECTED");
    const response = await fetchImpl(`${options.apiUrl.replace(/\/+$/, "")}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${options.apiKey}`, "x-api-key": options.apiKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(serialized === undefined ? {} : { body: serialized }) });
    if (!response.ok) throw new Error(`SYNC_HTTP_${response.status}`);
    return response.json();
  };
}

export const EVENT_CURSOR_PATH = "vg-sync/events-cursor.json";
export function readEventCursor(home: string): string | undefined {
  try {
    const cursor = (JSON.parse(readFileSync(syncPath(home, EVENT_CURSOR_PATH), "utf8")) as { cursor?: unknown }).cursor;
    return typeof cursor === "string" ? cursor : undefined;
  } catch { return undefined; }
}

/** Signal file the Hermes skill reads on its next cron run. Lives beside the cursor, never in vg-skills (a sync swaps that folder). */
export const WAKE_SIGNAL_PATH = "vg-sync/wake-signal.json";
export const WAKE_SIGNAL_CAP = 20;
/** Appends woken events, deduped by id, bounded to the newest WAKE_SIGNAL_CAP. Stores only id, type, time and a short summary. */
export function appendWakeSignal(home: string, events: PolledEvent[], now: () => string = () => new Date().toISOString()) {
  if (!events.length) return;
  let existing: { id: string; type: string; at: string; summary: string }[] = [];
  try {
    const parsed = JSON.parse(readFileSync(syncPath(home, WAKE_SIGNAL_PATH), "utf8")) as { events?: unknown };
    if (Array.isArray(parsed.events)) existing = parsed.events as typeof existing;
  } catch { existing = []; }
  const known = new Set(existing.map((row) => row.id));
  const at = now();
  const fresh = events.filter((event) => !known.has(event.id)).map((event) => ({ id: event.id, type: event.type, at, summary: event.summary.slice(0, 200) }));
  if (!fresh.length) return;
  atomicText(home, WAKE_SIGNAL_PATH, `${JSON.stringify({ events: [...existing, ...fresh].slice(-WAKE_SIGNAL_CAP) })}
`);
}

/** One event poll (TASK-129a step 4). Wakes only on subscribed kinds; logs counts and error codes only. */
export async function pollEventsOnce(options: SyncOptions, kinds: readonly string[], wake: (event: PolledEvent) => void) {
  const log = options.log ?? (() => undefined);
  const api = makeApi(options, options.fetchImpl ?? fetch);
  const cursor = readEventCursor(options.home);
  const woken: PolledEvent[] = [];
  try {
    const result = await pollAgentEventsOnce({
      kinds, wake: (event) => { woken.push(event); wake(event); },
      fetchEvents: async (since) => {
        const query = new URLSearchParams({ types: kinds.join(","), limit: "100" });
        if (since) query.set("since", since);
        return api(`/api/events?${query.toString()}`) as Promise<{ events: PolledEvent[] }>;
      },
    }, cursor);
    // Signal first: if it fails, the cursor stays put and the next poll wakes the same events again (deduped by id).
    appendWakeSignal(options.home, woken);
    atomicText(options.home, EVENT_CURSOR_PATH, `${JSON.stringify({ cursor: result.cursor ?? "" })}\n`);
    log(`vg-events-poll ok woke=${result.woke}`);
    return { ok: true as const, woke: result.woke };
  } catch (error) {
    // Cursor is kept unchanged on failure, so the next poll retries the same window.
    const code = error instanceof Error && /^SYNC_[A-Z0-9_]+$/.test(error.message) ? error.message : "SYNC_FAILED";
    log(`vg-events-poll ${code}; giữ con trỏ`);
    return { ok: false as const, code };
  }
}

export const INBOX_SEEN_PATH = "vg-sync/inbox-seen.json";
export function readInboxSeen(home: string): string[] | undefined {
  try {
    const ids = (JSON.parse(readFileSync(syncPath(home, INBOX_SEEN_PATH), "utf8")) as { ids?: unknown }).ids;
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : undefined;
  } catch { return undefined; }
}

/** One mailbox peek (TASK-129a step 4). Wakes once per unacked mail id; logs counts and error codes only. */
export async function pollInboxEventsOnce(options: SyncOptions, wake: (message: InboxPeek) => void) {
  const log = options.log ?? (() => undefined);
  const api = makeApi(options, options.fetchImpl ?? fetch);
  const seen = readInboxSeen(options.home);
  try {
    const result = await pollInboxOnce({
      wake,
      fetchPeek: () => api("/api/agents/mailbox/peek") as Promise<{ messages: InboxPeek[] }>,
    }, seen);
    atomicText(options.home, INBOX_SEEN_PATH, `${JSON.stringify({ ids: result.seen })}
`);
    log(`vg-inbox-poll ok woke=${result.woke}${result.primed ? " primed" : ""}`);
    return { ok: true as const, woke: result.woke };
  } catch (error) {
    const code = error instanceof Error && /^SYNC_[A-Z0-9_]+$/.test(error.message) ? error.message : "SYNC_FAILED";
    log(`vg-inbox-poll ${code}; giữ danh sách đã báo`);
    return { ok: false as const, code };
  }
}

export async function syncFleetOnce(options: SyncOptions) {
  const log = options.log ?? (() => undefined);
  const base = new URL(options.apiUrl);
  if (!options.apiKey || !["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("SYNC_CONNECTION_INVALID");
  const fetchImpl = options.fetchImpl ?? fetch;
  const api = makeApi(options, fetchImpl);
  try {
    const state = readState(options.home);
    const heartbeat = (pendingCron: string[] = []) => api("/api/agents/instances/heartbeat", { ...(options.instance ? { instance: options.instance } : {}), environment: options.environment ?? "docker", host: hostname(), hermesVersion: options.hermesVersion, bundleVersion: state.bundleVersion, skillsHash: state.skillsHash, toolHash: state.toolHash, pendingCron });
    await heartbeat();
    const bundle = FleetBundleSchema.parse(await api("/api/agents/bundle"));
    if (sha256(fleetBundlePayload(bundle)) !== bundle.hash) throw new Error("SYNC_HASH_MISMATCH");
    let reload = false;
    if (state.hash !== bundle.hash || state.bundleVersion !== bundle.bundleVersion) {
      // Parse/validate config before replacing the managed skill directory.
      const merged = mergeFleetConfig(options.home, bundle.configPatch, state.managed);
      reload = merged.changed;
      installFleetFiles(options.home, bundle.files);
      state.managed = merged.managed; state.bundleVersion = bundle.bundleVersion; state.hash = bundle.hash;
      state.skillsHash = sha256(JSON.stringify(bundle.files)); state.toolHash = bundle.toolHash;
    }
    let pushed = 0;
    for (const skill of localSkills(options.home)) {
      if (state.pushed[skill.name] === skill.hash) continue;
      // Use the version the instance knew BEFORE this pull, so a concurrent hub update is detected.
      const parentVersion = state.activeVersions[skill.name];
      await api("/api/agents/skills/drafts", { name: skill.name, markdown: skill.markdown, files: skill.files, ...(options.instance ? { instance: options.instance } : {}), ...(parentVersion ? { parentVersion } : {}), evidence: { reason: "Skill mới hoặc đã đổi trên instance; chờ eval và duyệt của hub.", runIds: [] } });
      state.pushed[skill.name] = skill.hash; pushed++;
    }
    const pending = cronCommands(options.home, bundle);
    await heartbeat(pending);
    state.activeVersions = bundle.skillVersions;
    atomicText(options.home, "vg-sync/state.json", `${JSON.stringify(state, null, 2)}\n`);
    log(`vg-hermes-sync ok bundle=${state.bundleVersion} pushed=${pushed}${reload ? " — chạy /reload-mcp hoặc khởi động lại gateway" : ""}`);
    return { ok: true as const, bundleVersion: state.bundleVersion, pushed, pendingCron: pending, reload };
  } catch (error) {
    // Never log network errors/response bodies: either could contain a credential.
    const code = error instanceof Error && /^SYNC_[A-Z0-9_]+$/.test(error.message) ? error.message : "SYNC_FAILED";
    log(`vg-hermes-sync ${code}; giữ gói đã đồng bộ gần nhất`);
    return { ok: false as const, code };
  }
}
/** TASK-129a step 4: poll every 15 s until stopped. The poll functions catch their own errors; this is a backstop that logs one fixed line (no error text) and keeps polling. */
export async function runEventPollLoop(opts: { isStopped: () => boolean; pollOnce: () => Promise<void>; intervalMs?: number; log?: (line: string) => void }): Promise<void> {
  const intervalMs = opts.intervalMs ?? 15_000;
  while (!opts.isStopped()) {
    try { await opts.pollOnce(); } catch { opts.log?.("vg-event-poll-loop lỗi không xử lý; tiếp tục vòng sau"); }
    if (opts.isStopped()) break;
    await new Promise<void>((done) => setTimeout(done, intervalMs));
  }
}
async function main() {
  const interval = Number(process.env.VG_SYNC_INTERVAL_SEC ?? "300");
  if (!Number.isFinite(interval) || interval < 10 || interval > 86400) throw new Error("VG_SYNC_INTERVAL_SEC không hợp lệ");
  const options: SyncOptions = { home: process.env.VG_HERMES_HOME ?? process.env.HERMES_HOME ?? join(homedir(), ".hermes"), apiUrl: process.env.VG_API_URL ?? "http://127.0.0.1:3001", apiKey: process.env.VG_API_KEY ?? "", secretValues: [process.env.VG_API_KEY ?? ""], instance: process.env.VG_AGENT_NAME, environment: process.env.VG_ENVIRONMENT ?? "wsl", hermesVersion: process.env.HERMES_VERSION ?? "unknown", log: (line) => process.stdout.write(`${line}\n`) };
  // Version comes from the pinned image/launcher environment; never spawn a real Hermes CLI.
  let stopped = false;
  process.once("SIGTERM", () => { stopped = true; }); process.once("SIGINT", () => { stopped = true; });
  // Event poller (TASK-129a step 4): own 15 s loop, only when kinds are configured. The default wake only counts.
  const kinds = (process.env.VG_EVENT_POLL_KINDS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const inboxOn = process.env.VG_INBOX_POLL === "1";
  const polling = kinds.length || inboxOn ? runEventPollLoop({
    isStopped: () => stopped,
    log: options.log,
    pollOnce: async () => {
      if (kinds.length) await pollEventsOnce(options, kinds, () => undefined);
      if (inboxOn) await pollInboxEventsOnce(options, () => undefined);
    },
  }) : Promise.resolve();
  do {
    await syncFleetOnce(options);
    if (process.argv.includes("--once") || stopped) break;
    await new Promise<void>((done) => {
      const finish = () => { clearTimeout(timer); process.off("SIGTERM", finish); process.off("SIGINT", finish); done(); };
      const timer = setTimeout(finish, interval * 1000);
      process.once("SIGTERM", finish); process.once("SIGINT", finish);
    });
  } while (!stopped);
  await polling;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write("vg-hermes-sync cấu hình không hợp lệ\n"); process.exitCode = 1; });
