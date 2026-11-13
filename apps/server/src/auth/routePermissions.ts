import type Database from "better-sqlite3";
import type { Action } from "./policy.js";

export type ResourceKind = "workspace" | "project" | "profile" | "account" | "publication" | "comment" | "instance" | "job";

export type RouteRule = {
  method: "READ" | "WRITE" | "ANY" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string;
  /** null: any signed-in member (the handler narrows by scope). */
  action: Action | null;
  resource: ResourceKind;
};

const r = (method: RouteRule["method"], pattern: string, action: Action | null, resource: ResourceKind = "workspace"): RouteRule =>
  ({ method, pattern, action, resource });

/**
 * One place that says which action each API route needs. First match wins, so specific rules come first.
 * A `:name` segment matches any one segment. A segment ending in `*` matches the rest of the path.
 */
export const ROUTE_RULES: RouteRule[] = [
  // identity, audit, workspace
  r("READ", "/api/me", null),
  r("READ", "/api/audit", "audit.read"),
  r("ANY", "/api/workspace*", "members.manage"),

  // projects: pipeline
  r("POST", "/api/projects/:id/pipeline/gates/:gate/approve", "gate.approve", "project"),
  r("POST", "/api/projects/:id/translations/:childId/approve", "gate.approve", "project"),
  r("POST", "/api/projects/:id/pipeline/*", "stage.run", "project"),
  r("POST", "/api/projects/:id/render", "stage.run", "project"),
  r("POST", "/api/projects/:id/render-variants", "stage.run", "project"),
  r("POST", "/api/projects/:id/originality/recheck", "stage.run", "project"),
  r("POST", "/api/projects/:id/quality-repairs/reopen", "stage.run", "project"),
  r("POST", "/api/projects/:id/guidelines/check", "stage.run", "project"),
  r("POST", "/api/projects/:id/publications", "publish", "project"),
  r("POST", "/api/projects/:id/scenes/:sceneId/voice/regenerate", "stage.run", "project"),
  r("POST", "/api/projects/:id/scenes/:sceneId/visuals/search", "stage.run", "project"),
  r("POST", "/api/projects/:id/scenes/:sceneId/visuals/web-search", "stage.run", "project"),
  r("POST", "/api/projects/:id/visuals/research", "stage.run", "project"),
  r("POST", "/api/projects/:id/music/search", "stage.run", "project"),
  r("POST", "/api/projects/:id/metadata/generate", "stage.run", "project"),
  r("READ", "/api/projects/:id/*", "project.read", "project"),
  r("WRITE", "/api/projects/:id/*", "project.write", "project"),
  r("READ", "/api/projects/:id", "project.read", "project"),
  r("WRITE", "/api/projects/:id", "project.write", "project"),
  r("READ", "/api/projects", "project.read"),
  r("POST", "/api/projects", "project.write"),
  r("POST", "/api/clips/import", "project.write"),

  // channels
  r("WRITE", "/api/profiles/visual-quality", "project.write"),
  r("PUT", "/api/profiles/:id/accounts/:accountId/app-credentials", "secrets.write", "profile"),
  r("DELETE", "/api/profiles/:id/accounts/:accountId/app-credentials", "secrets.write", "profile"),
  r("WRITE", "/api/profiles/:id/accounts*", "channel.manage", "profile"),
  r("READ", "/api/profiles/:id/accounts*", "channel.read", "profile"),
  r("READ", "/api/profiles/:id/learning*", "analytics.read", "profile"),
  r("POST", "/api/profiles/:id/topics/approve", "gate.approve", "profile"),
  r("WRITE", "/api/profiles/:id/topics*", "project.write", "profile"),
  r("WRITE", "/api/profiles/:id/learning*", "project.write", "profile"),
  r("WRITE", "/api/profiles/:id/trends/*", "project.write", "profile"),
  r("WRITE", "/api/profiles/:id/insights/*", "project.write", "profile"),
  // Style pack (TASK-111): a preview saves nothing, so it only needs a read. `propose` spends
  // model budget and stays with the generic profile write rule (channel.manage).
  r("POST", "/api/profiles/:id/style-pack/preview", "channel.read", "profile"),
  r("READ", "/api/profiles/:id/*", "channel.read", "profile"),
  r("WRITE", "/api/profiles/:id/*", "channel.manage", "profile"),
  r("READ", "/api/profiles/:id", "channel.read", "profile"),
  r("WRITE", "/api/profiles/:id", "channel.manage", "profile"),
  r("READ", "/api/profiles", "channel.read"),
  r("POST", "/api/profiles", "channel.manage"),
  r("READ", "/api/accounts*", "channel.read"),
  r("WRITE", "/api/accounts/:id/*", "channel.manage", "account"),
  r("READ", "/api/analytics/publications/:id", "analytics.read", "publication"),
  r("POST", "/api/analytics/accounts/:id/sync", "channel.manage", "account"),
  r("READ", "/api/analytics/*", "analytics.read"),
  r("READ", "/api/oauth/:platform/start", "channel.manage"),

  // publications and comments
  r("READ", "/api/publications", "project.read"),
  r("POST", "/api/publications/:id/*", "publish", "publication"),
  r("POST", "/api/comments/bulk-spam", "comments.reply"),
  r("READ", "/api/comments*", "channel.read"),
  r("WRITE", "/api/comments/:id*", "comments.reply", "comment"),

  // money
  r("READ", "/api/finance/*", "finance.read"),
  r("WRITE", "/api/finance/*", "finance.write"),

  // overview
  r("READ", "/api/dashboard/*", "project.read"),
  r("READ", "/api/usage", "project.read"),
  r("READ", "/api/events", "project.read"),
  r("READ", "/api/quality-repairs/*", "project.read"),
  r("READ", "/api/agents*", "settings.read"),

  // assistant (the pending-action role check happens in the registry)
  r("PUT", "/api/assistant/settings", "settings.write"),
  r("READ", "/api/assistant/settings", "settings.read"),
  r("ANY", "/api/assistant/*", null),

  // operator and automation
  r("ANY", "/api/operator/*", "operator.use"),
  r("READ", "/api/autonomy/*", "settings.read"),
  r("WRITE", "/api/autonomy/*", "automation.manage"),
  r("READ", "/api/automation/*", "settings.read"),
  r("WRITE", "/api/automation/*", "automation.manage"),

  // secrets and connections
  r("PUT", "/api/settings/tts/secret", "secrets.write"),
  r("ANY", "/api/settings/llm-providers/custom*", "secrets.write"),
  r("DELETE", "/api/settings/llm-providers/:id/key", "secrets.write"),
  r("POST", "/api/settings/llm-providers/openrouter/start", "secrets.write"),
  r("POST", "/api/settings/import-env", "secrets.write"),
  r("PUT", "/api/settings/llm-providers/:id", "secrets.write"),
  r("PUT", "/api/trends/youtube-key", "secrets.write"),
  r("PUT", "/api/connections/secrets/:id", "secrets.write"),
  r("DELETE", "/api/connections/secrets/:id", "secrets.write"),
  r("PUT", "/api/connections/setup", "secrets.write"),
  r("PUT", "/api/connections/platform-apps/:platform", "secrets.write"),
  r("PUT", "/api/notifications/telegram/token", "secrets.write"),
  r("DELETE", "/api/notifications/telegram/token", "secrets.write"),
  r("PUT", "/api/llm/quota/omniroute/token", "secrets.write"),
  r("DELETE", "/api/llm/quota/omniroute/token", "secrets.write"),
  r("READ", "/api/connections/*", "settings.read"),
  r("WRITE", "/api/connections/*", "settings.write"),

  // settings
  r("READ", "/api/settings/*", "settings.read"),
  r("WRITE", "/api/settings/*", "settings.write"),
  r("READ", "/api/llm/*", "settings.read"),
  r("WRITE", "/api/llm/*", "settings.write"),
  r("READ", "/api/provider-intel/*", "settings.read"),
  r("WRITE", "/api/provider-intel/*", "settings.write"),
  r("READ", "/api/notifications/*", "settings.read"),
  r("WRITE", "/api/notifications/*", "settings.write"),
  r("READ", "/api/webhooks*", "settings.read"),
  r("WRITE", "/api/webhooks*", "settings.write"),
  r("READ", "/api/skill-reports*", "settings.read"),
  r("WRITE", "/api/skill-reports*", "settings.write"),
  r("READ", "/api/retrieval/settings*", "settings.read"),
  r("WRITE", "/api/retrieval/settings*", "settings.write"),
  r("POST", "/api/retrieval/profiles/:id/search", "channel.read", "profile"),
  r("READ", "/api/retrieval/profiles/:id/*", "channel.read", "profile"),
  r("WRITE", "/api/retrieval/profiles/:id/*", "project.write", "profile"),
  r("READ", "/api/retrieval/projects/:id/*", "project.read", "project"),
  r("WRITE", "/api/retrieval/projects/:id/*", "project.write", "project"),
  r("READ", "/api/trends/*", "settings.read"),
  r("WRITE", "/api/trends/*", "settings.write"),
  r("READ", "/api/guidelines/*", "project.read"),
  r("WRITE", "/api/guidelines/*", "settings.write"),
  r("READ", "/api/knowledge*", "project.read"),
  r("WRITE", "/api/knowledge*", "project.write"),
  r("READ", "/api/registry/*", "settings.read"),
  r("POST", "/api/registry/invoke", null),

  // shared helpers any member may use
  r("READ", "/api/help/*", null),
  r("READ", "/api/markets*", null),
  r("READ", "/api/motion/*", null),
  r("POST", "/api/motion/*", "project.write"),
  r("READ", "/api/tts/*", null),
  r("READ", "/api/style/*", null),
  r("POST", "/api/recommendations", "project.read"),

  // worker nodes (admin side; the agent routes under /api/nodes/agent/ use node tokens)
  r("ANY", "/api/nodes*", "nodes.manage"),

  // TASK-125: a job that ran past its expected time
  r("READ", "/api/jobs/:id/overdue-checks", "project.read", "job"),
  r("POST", "/api/jobs/:id/overdue-decision", "stage.run", "job"),
];

function patternMatches(pattern: string, template: string): boolean {
  const p = pattern.split("/");
  const t = template.split("/");
  for (let i = 0; i < p.length; i += 1) {
    const seg = p[i]!;
    const other = t[i];
    if (seg === "*") return other !== undefined;
    if (other === undefined) return false;
    if (seg.endsWith("*")) return other.startsWith(seg.slice(0, -1));
    if (seg.startsWith(":")) continue;
    if (seg !== other) return false;
  }
  return p.length === t.length;
}

function methodMatches(rule: RouteRule["method"], method: string): boolean {
  const m = method.toUpperCase();
  if (rule === "ANY") return true;
  if (rule === "READ") return m === "GET" || m === "HEAD";
  if (rule === "WRITE") return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  return rule === m;
}

export function findRule(method: string, template: string): RouteRule | undefined {
  return ROUTE_RULES.find((rule) => methodMatches(rule.method, method) && patternMatches(rule.pattern, template));
}

export type LoadedResource = { workspaceId: string | null; profileId?: string | null } | null;

/** Look up the workspace and channel a resource belongs to. */
export function loadResource(sqlite: Database.Database, kind: ResourceKind, params: Record<string, unknown>): LoadedResource {
  const id = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
  const one = (sql: string, arg: string) =>
    sqlite.prepare(sql).get(arg) as { workspaceId: string | null; profileId?: string | null } | undefined;
  switch (kind) {
    case "project": {
      const projectId = id(params.id) ?? id(params.projectId);
      if (!projectId) return null;
      return one("SELECT workspace_id AS workspaceId, profile_id AS profileId FROM projects WHERE id = ?", projectId) ?? null;
    }
    case "profile": {
      const profileId = id(params.id) ?? id(params.profileId);
      if (!profileId) return null;
      const row = one("SELECT workspace_id AS workspaceId FROM profiles WHERE id = ?", profileId);
      return row ? { workspaceId: row.workspaceId, profileId } : null;
    }
    case "account": {
      const accountId = id(params.accountId) ?? id(params.id);
      if (!accountId) return null;
      return one(
        "SELECT p.workspace_id AS workspaceId, p.id AS profileId FROM platform_accounts a JOIN profiles p ON p.id = a.profile_id WHERE a.id = ?",
        accountId,
      ) ?? null;
    }
    case "publication": {
      const publicationId = id(params.id);
      if (!publicationId) return null;
      return one(
        "SELECT j.workspace_id AS workspaceId, j.profile_id AS profileId FROM publications u JOIN projects j ON j.id = u.project_id WHERE u.id = ?",
        publicationId,
      ) ?? null;
    }
    case "comment": {
      const commentId = id(params.id);
      if (!commentId) return null;
      return one(
        "SELECT j.workspace_id AS workspaceId, j.profile_id AS profileId FROM comments c JOIN publications u ON u.id = c.publication_id JOIN projects j ON j.id = u.project_id WHERE c.id = ?",
        commentId,
      ) ?? null;
    }
    case "job": {
      const jobId = id(params.id);
      if (!jobId) return null;
      return one(
        "SELECT p.workspace_id AS workspaceId, p.profile_id AS profileId FROM jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?",
        jobId,
      ) ?? null;
    }
    default:
      return null;
  }
}
