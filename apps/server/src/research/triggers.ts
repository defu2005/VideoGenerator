import type Database from "better-sqlite3";
import { currentWorkspaceId } from "../auth/requestContext.js";
import { ChangeInbox, type ChangeEventRow } from "../knowledge/changeInbox.js";

export function researchEventVisible(db: Database.Database, event: ChangeEventRow): boolean {
  if (["knowledge", "provider", "platform", "dependency"].includes(event.subject.type)) return true;
  const workspace = currentWorkspaceId(db);
  if (event.subject.type === "video") return !!db.prepare("SELECT 1 FROM projects WHERE id=? AND workspace_id IS ?").get(event.subject.id, workspace);
  return !!db.prepare("SELECT 1 FROM platform_accounts a JOIN profiles p ON p.id=a.profile_id WHERE a.id=? AND p.workspace_id IS ?").get(event.subject.id, workspace);
}
export function researchEvents(db: Database.Database) {
  return new ChangeInbox(db).list({ status: "open" }).filter((event) => event.reaction.levels.includes("R5") && researchEventVisible(db, event));
}
