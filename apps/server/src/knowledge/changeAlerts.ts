import type Database from "better-sqlite3";
import type { NotificationEvent } from "@vg/shared";
import { ChangeInbox } from "./changeInbox.js";

/** Existing notification service owns opt-in, quiet hours, delivery and secret masking. */
export async function deliverChangeAlerts(db: Database.Database, notify: (event: NotificationEvent) => Promise<void>): Promise<void> {
  const inbox = new ChangeInbox(db);
  const seen = new Set(JSON.parse(inbox.setting("change.alerted") ?? "[]") as string[]);
  for (const event of inbox.list({ status: "open" }).filter(x => x.severity === "high" || x.severity === "critical").reverse()) {
    if (seen.has(event.id)) continue;
    await notify({ kind: "automation_warning", profile: "Thay đổi bên ngoài", message: event.summary, logId: event.id });
    seen.add(event.id);
    inbox.putSetting("change.alerted", JSON.stringify([...seen].slice(-2000)));
  }
}
