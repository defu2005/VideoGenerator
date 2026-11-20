import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type Database from "better-sqlite3";
import { currentScope, currentWorkspaceId } from "../auth/requestContext.js";
import { listAgentEvents, subscribeAgentEvents } from "../events/agentBus.js";

/** An event is shown when the viewer's workspace and channels cover its project. */
function visibleTo(sqlite: { prepare(sql: string): { get(...a: unknown[]): unknown } }, scope: ReturnType<typeof currentScope>): (event: { projectId?: string | null }) => boolean {
  if (!scope) return () => true;
  return (event) => {
    if (!event.projectId) return scope.profileIds === "all";
    const row = sqlite.prepare("SELECT workspace_id AS w, profile_id AS p FROM projects WHERE id = ?").get(event.projectId) as
      { w: string | null; p: string | null } | undefined;
    if (!row || row.w !== scope.workspaceId) return false;
    if (scope.profileIds === "all") return true;
    return row.p === null ? scope.includeUnassigned : scope.profileIds.includes(row.p);
  };
}

/** Non-mailbox events carry no workspace and stay unscoped (known gap). Mailbox events need the viewer's workspace, and fail closed when there is none. */
export function agentEventInWorkspace(eventWorkspace: string | undefined, viewerWorkspace: string | null): boolean {
  return eventWorkspace === undefined || (viewerWorkspace !== null && eventWorkspace === viewerWorkspace);
}

export function registerAgentEventRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.get("/api/events", async (request, reply) => {
    const query = z.object({
      since: z.string().optional(),
      types: z.string().optional(),
      projectId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }).parse(request.query);
    const lastEventId = request.headers["last-event-id"];
    const since = typeof lastEventId === "string" && lastEventId ? lastEventId : query.since;
    const scope = currentScope();
    const visibleEvent = visibleTo(sqlite, scope);
    const viewerWorkspace = currentWorkspaceId(sqlite);
    const visible = (event: { projectId?: string | null }, eventWorkspace?: string) =>
      agentEventInWorkspace(eventWorkspace, viewerWorkspace) && visibleEvent(event);
    const events = listAgentEvents({
      since, projectId: query.projectId, limit: query.limit, workspaceId: viewerWorkspace ?? "",
      types: query.types?.split(",").filter(Boolean),
    }).filter((event) => visible(event));
    const wantsStream = request.headers.accept?.includes("text/event-stream");
    if (!wantsStream) return { events };
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.flushHeaders();
    for (const event of events) response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = subscribeAgentEvents((event, eventWorkspace) => {
      if (!visible(event, eventWorkspace)) return;
      response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);
    heartbeat.unref();
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
