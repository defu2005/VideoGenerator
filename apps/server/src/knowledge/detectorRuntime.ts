import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { validatePublicHttpUrl } from "../providers/images/webCrawl.js";
import { INTEL_USER_AGENT } from "../providerIntel/omniroute.js";
import { ChangeInbox } from "./changeInbox.js";
import { KnowledgeService } from "./service.js";
import { assertReadOnlyNpm } from "./documentWatch.js";
import { fetchOfficialPage } from "./officialPage.js";
import { DetectorScheduler, type DetectorScheduleDeps } from "./detectorScheduler.js";

/** Real runners are only composed here. Tests inject fake clocks/network/npm into DetectorScheduler. */
export function createDetectorRuntime(db: Database.Database, options: {
  signal: AbortSignal; health: () => Promise<void>; drift: () => Promise<void>;
  audit: DetectorScheduleDeps["audit"]; llm?: DetectorScheduleDeps["llm"];
}) {
  const inbox = new ChangeInbox(db), cache = new Map<string, { at: number; page: Awaited<ReturnType<typeof fetchOfficialPage>> }>();
  let connectivity: { at: number; online: boolean } | undefined;
  return new DetectorScheduler({
    inbox, knowledge: new KnowledgeService(db), now: () => new Date(), eco: () => inbox.setting("change.eco") === "true",
    online: async () => {
      if (options.signal.aborted || inbox.setting("change.offline") === "true") return false;
      if (connectivity && Date.now() - connectivity.at < 5 * 60_000) return connectivity.online;
      let online = false;
      try { online = (await fetch("https://registry.npmjs.org/-/ping", { redirect: "error", signal: AbortSignal.any([options.signal, AbortSignal.timeout(3000)]) })).ok; } catch { /* Offline; no detector effects. */ }
      connectivity = { at: Date.now(), online }; return online;
    },
    fetch: async url => {
      const previous = cache.get(url); if (previous && Date.now() - previous.at < 6 * 3_600_000) return previous.page;
      try {
        const page = await fetchOfficialPage(url, async (target, init) => {
          await validatePublicHttpUrl(target);
          return fetch(target, { ...init, redirect: "manual", signal: AbortSignal.any([options.signal, init?.signal ?? AbortSignal.timeout(15_000)]) });
        }, INTEL_USER_AGENT);
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(url, { at: Date.now(), page }); return page;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ROBOTS_DISALLOW") return { status: 403, url, text: "" };
        throw error;
      }
    },
    npm: command => runReadOnlyNpm(command, options.signal), audit: options.audit, llm: options.llm,
    health: options.health, drift: options.drift,
  });
}

export function runReadOnlyNpm(command: string, signal: AbortSignal): Promise<unknown> {
  assertReadOnlyNpm(command);
  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  const executable = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : command.split(" ").slice(1);
  return new Promise((resolve, reject) => {
    execFile(executable, args, { cwd, signal, timeout: 60_000, maxBuffer: 5_000_000, windowsHide: true }, (error, stdout) => {
      // npm audit/outdated return nonzero when findings exist; valid JSON is still a result.
      try { resolve(JSON.parse(stdout)); } catch { reject(error ?? new Error("npm không trả JSON.")); }
    });
  });
}
