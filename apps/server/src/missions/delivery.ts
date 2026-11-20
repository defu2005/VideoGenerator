import type Database from "better-sqlite3";
import type { NotificationEvent } from "@vg/shared";
import type { NotifyOutcome } from "../notifications/notificationService.js";
import { markPinged, missionsToPing } from "./checkpoints.js";

// TASK-129c slice 2b: sends checkpoint reports and waiting-user reminders through the notification service.
// Never throws. A send that fails is not recorded as a reminder; it is retried once RETRY_BACKOFF_MS has passed.
// A checkpoint is already recorded in the database before it is sent, so a failed send never re-fires it.

export type MissionNotifier = { deliver(event: NotificationEvent): Promise<NotifyOutcome> };

export const RETRY_BACKOFF_MS = 5 * 60 * 1000;
// Per database, in memory: a restart clears the backoff, which only costs one early retry.
const retryByDb = new WeakMap<Database.Database, Map<string, number>>();
function retryTimes(sqlite: Database.Database): Map<string, number> {
  let map = retryByDb.get(sqlite);
  if (!map) { map = new Map(); retryByDb.set(sqlite, map); }
  return map;
}

export type FiredCheckpoint = { missionId: string; kind: string };

export async function deliverMissionNotices(
  sqlite: Database.Database,
  notifier: MissionNotifier,
  fired: FiredCheckpoint[],
  now: Date,
  webBaseUrl: string,
): Promise<void> {
  const reportOf = sqlite.prepare("SELECT report FROM mission_checkpoints WHERE mission_id = ? AND kind = ?");
  const commandOf = sqlite.prepare("SELECT command FROM missions WHERE id = ?");
  for (const item of fired) {
    try {
      const row = reportOf.get(item.missionId, item.kind) as { report: string | null } | undefined;
      const mission = commandOf.get(item.missionId) as { command: string } | undefined;
      if (!row?.report || !mission) continue;
      await notifier.deliver({
        kind: "mission_checkpoint",
        missionId: item.missionId,
        command: mission.command,
        checkpoint: item.kind,
        report: row.report,
      });
    } catch {
      // Nothing to do: the checkpoint is already stored and the report stays readable in the app.
    }
  }

  const retryAt = retryTimes(sqlite);
  for (const missionId of missionsToPing(sqlite, now)) {
    // A reminder that failed waits RETRY_BACKOFF_MS before the next attempt, so a down Telegram is not hammered every tick.
    const wait = retryAt.get(missionId);
    if (wait !== undefined && now.getTime() < wait) continue;
    try {
      const mission = commandOf.get(missionId) as { command: string } | undefined;
      if (!mission) continue;
      const outcome = await notifier.deliver({
        kind: "mission_waiting_user",
        missionId,
        command: mission.command,
        link: `${webBaseUrl}/missions/${missionId}`,
        at: now.toISOString(),
      });
      // "sent" and "skipped" (Telegram off or unpaired) both count as handled, so the 6 h throttle starts.
      // "failed" is left unmarked: it is retried after RETRY_BACKOFF_MS.
      if (outcome === "sent" || outcome === "skipped" || outcome === "deduped") {
        markPinged(sqlite, missionId, now);
        retryAt.delete(missionId);
      } else {
        retryAt.set(missionId, now.getTime() + RETRY_BACKOFF_MS);
      }
    } catch {
      // Leave unmarked; the next attempt after the backoff retries.
      retryAt.set(missionId, now.getTime() + RETRY_BACKOFF_MS);
    }
  }
}
