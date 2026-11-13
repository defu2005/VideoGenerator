import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";
import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { AuthActor } from "./actor.js";
import type { Scope } from "./policy.js";
import { scopeFor } from "./policy.js";
import { defaultWorkspaceId } from "./workspaces.js";

export type RequestContext = { actor?: AuthActor; scope?: Scope };

const storage = new AsyncLocalStorage<RequestContext>();

export function runInRequestContext(done: () => void): void {
  storage.run({}, done);
}

/** Run code as an actor (tests, scripts). Services read it the same way as inside an HTTP request. */
export function runAsActor<T>(actor: AuthActor, fn: () => T): T {
  return storage.run({ actor, scope: scopeFor(actor) }, fn);
}

export function setContextActor(actor: AuthActor): void {
  const store = storage.getStore();
  if (!store) return;
  store.actor = actor;
  store.scope = scopeFor(actor);
}

export function currentActor(): AuthActor | undefined {
  return storage.getStore()?.actor;
}

/** The scope of the request being served, or undefined for in-process work that acts as the system. */
export function currentScope(): Scope | undefined {
  return storage.getStore()?.scope;
}

/** Workspace for a new root row: the request's workspace, else the default one. */
export function currentWorkspaceId(sqlite: Database.Database): string | null {
  return currentScope()?.workspaceId ?? defaultWorkspaceId(sqlite);
}

/** Drizzle condition limiting rows to the request's workspace and visible channels. */
export function scopeCondition(workspaceCol: SQLiteColumn, profileCol?: SQLiteColumn): SQL | undefined {
  const scope = currentScope();
  if (!scope) return undefined;
  const parts: SQL[] = [sql`${workspaceCol} = ${scope.workspaceId}`];
  if (profileCol && scope.profileIds !== "all") {
    parts.push(scope.profileIds.length === 0
      ? sql`1 = 0`
      : sql`${profileCol} IN (${sql.join(scope.profileIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  return parts.length === 1 ? parts[0] : sql.join(parts.map((part) => sql`(${part})`), sql` AND `);
}

/** Raw SQL fragment ("1=1" when there is no scope) plus its parameters. */
export function scopeSql(workspaceCol: string, profileCol?: string): { sql: string; args: string[] } {
  const scope = currentScope();
  if (!scope) return { sql: "1 = 1", args: [] };
  const parts = [`${workspaceCol} = ?`];
  const args = [scope.workspaceId];
  if (profileCol && scope.profileIds !== "all") {
    if (scope.profileIds.length === 0) parts.push("1 = 0");
    else {
      parts.push(`${profileCol} IN (${scope.profileIds.map(() => "?").join(", ")})`);
      args.push(...scope.profileIds);
    }
  }
  return { sql: parts.join(" AND "), args };
}

/** Scope a query that only knows a profile column (accounts, publications): the profile must be in the workspace and visible. */
export function profileScopeSql(profileCol: string): { sql: string; args: string[] } {
  const scope = currentScope();
  if (!scope) return { sql: "1 = 1", args: [] };
  const parts = [`${profileCol} IN (SELECT id FROM profiles WHERE workspace_id = ?)`];
  const args = [scope.workspaceId];
  if (scope.profileIds !== "all") {
    if (scope.profileIds.length === 0) parts.push("1 = 0");
    else {
      parts.push(`${profileCol} IN (${scope.profileIds.map(() => "?").join(", ")})`);
      args.push(...scope.profileIds);
    }
  }
  return { sql: parts.join(" AND "), args };
}

/** Give a freshly inserted root row the current workspace (or an explicit one) unless it already has one. */
export function stampWorkspace(sqlite: Database.Database, table: string, id: string, workspaceId?: string | null, idColumn = "id"): void {
  const target = workspaceId ?? currentWorkspaceId(sqlite);
  if (!target) return;
  sqlite.prepare(`UPDATE ${table} SET workspace_id = ? WHERE ${idColumn} = ? AND workspace_id IS NULL`).run(target, id);
}

/** Child rows (clips, translations) live in the workspace of their parent. */
export function inheritWorkspace(sqlite: Database.Database, table: string, id: string, parentTable: string, parentId: string): void {
  const row = sqlite.prepare(`SELECT workspace_id AS w FROM ${parentTable} WHERE id = ?`).get(parentId) as { w: string | null } | undefined;
  stampWorkspace(sqlite, table, id, row?.w ?? null);
}

export function workspaceOfProfile(sqlite: Database.Database, profileId: string): string | null {
  const row = sqlite.prepare("SELECT workspace_id AS w FROM profiles WHERE id = ?").get(profileId) as { w: string | null } | undefined;
  return row?.w ?? null;
}
