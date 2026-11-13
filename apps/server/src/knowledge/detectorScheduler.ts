import type { KnowledgeEntry } from "@vg/shared";
import { ChangeInbox } from "./changeInbox.js";
import { assertReadOnlyNpm, dependencyCommands, runDependencySweep, runDocumentWatchFull, type WatchFetch, type WatchModel } from "./documentWatch.js";
import type { KnowledgeService } from "./service.js";

export type DetectorScheduleDeps = {
  inbox: ChangeInbox; knowledge: Pick<KnowledgeService, "list">;
  now: () => Date; online: () => boolean | Promise<boolean>; eco: () => boolean;
  fetch: WatchFetch; llm?: WatchModel;
  npm: (command: string) => Promise<unknown>;
  audit: (result: { task: string; status: "ok" | "error" | "offline"; at: string }) => void;
  health?: () => Promise<void>; drift?: () => Promise<void>;
};
const interval = (entry: KnowledgeEntry) => entry.volatility === "weekly" ? 1 : entry.volatility === "monthly" ? 3.5 : 7;

/** Called by the existing app heartbeat; persistent cadence survives restarts. */
export class DetectorScheduler {
  private running: Promise<void> | undefined;
  constructor(private readonly deps: DetectorScheduleDeps) {}
  tick(): Promise<void> {
    return this.running ??= this.run().finally(() => { this.running = undefined; });
  }
  private async run(): Promise<void> {
    const d = this.deps, now = d.now(), at = now.toISOString();
    if (!await d.online()) { d.audit({ task: "detectors", status: "offline", at }); return; }
    const run = async (key: string, days: number, fn: () => Promise<unknown> | unknown) => {
      if (!await d.online()) return;
      const last = d.inbox.setting(`change.schedule.${key}`);
      if (last && now.getTime() - Date.parse(last) < days * 86_400_000) return;
      try {
        await fn(); d.inbox.putSetting(`change.schedule.${key}`, at);
        d.audit({ task: key, status: "ok", at });
      } catch {
        // Retry on the next daily sweep, not every 30-second heartbeat.
        d.inbox.putSetting(`change.schedule.${key}`, new Date(now.getTime() - (days - 1) * 86_400_000).toISOString());
        d.audit({ task: key, status: "error", at });
      }
    };
    await run("prune", 1, () => d.inbox.pruneSignalHits());
    if (d.health) await run("health", 1, d.health);
    if (d.drift) await run("drift", 1, d.drift);
    const entries = d.knowledge.list();
    await run("stale", 7, () => d.inbox.sweepStale(entries.map(({ entry, freshness }) => ({ id: entry.id, kind: entry.kind, freshness }))));
    const watches = new Map<string, { url: string; entry: KnowledgeEntry; kind: KnowledgeEntry["watch"][number]["kind"] }>();
    for (const { entry } of entries) for (const watch of entry.watch) {
      watches.set(`${entry.id}:${watch.url}`, { url: watch.url, entry, kind: watch.kind });
    }
    let watchesRun = 0;
    const pages = new Map<string, ReturnType<WatchFetch>>();
    for (const [key, { url, entry, kind }] of watches) {
      if (watchesRun >= 5) break;
      await run(`watch:${key}`, interval(entry), () => {
        watchesRun++;
        return runDocumentWatchFull(d.inbox, {
          url, kind, category: "G1", subjectId: entry.id, fetch: () => {
            if (!pages.has(url)) pages.set(url, d.fetch(url));
            return pages.get(url)!;
          }, llm: d.llm, eco: d.eco(),
        });
      });
    }
    await run("dependencies", 7, async () => {
      const commands = dependencyCommands();
      assertReadOnlyNpm(commands.outdated); assertReadOnlyNpm(commands.audit);
      const outdated = await d.npm(commands.outdated), audit = await d.npm(commands.audit);
      runDependencySweep(d.inbox, outdated, audit);
    });
  }
}
