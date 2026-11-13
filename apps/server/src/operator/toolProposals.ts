import { randomUUID } from "node:crypto";
import { containsProtectedProject, redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

const JsonObjectSchema = z.record(z.string(), z.json()).refine((value) => value.type === "object",
  "Schema phải khai báo type object.");
export const ToolProposalArgs = z.object({
  kind: z.enum(["internal", "external_mcp"]),
  name: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
  operation: z.string().trim().min(8).max(500),
  reproduction: z.string().trim().min(8).max(1000),
  impact: z.string().trim().min(8).max(500),
  inputSchema: JsonObjectSchema,
  outputSchema: JsonObjectSchema,
  permissions: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  dataSent: z.string().trim().min(2).max(500),
  requiresConfirmation: z.boolean(),
  acceptance: z.array(z.string().trim().min(5).max(300)).min(1).max(6),
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
}).strict().refine((value) => value.kind !== "external_mcp" || Boolean(value.sourceUrl), "MCP bên ngoài cần URL nguồn.");

type Proposal = z.output<typeof ToolProposalArgs>;

export function recordToolProposal(
  db: Database.Database, proposal: Proposal, registry: ReadonlySet<string>,
): { status: "existing_tool" | "duplicate" | "proposed"; id?: string; name: string } {
  if (registry.has(proposal.name)) return { status: "existing_tool", name: proposal.name };
  const json = JSON.stringify(proposal);
  if (json.length > 12_000 || containsProtectedProject(proposal) || redactExportText(json) !== json
      || (proposal.sourceUrl && (new URL(proposal.sourceUrl).username || new URL(proposal.sourceUrl).password))) {
    throw new AppError(400, "INVALID_TOOL_PROPOSAL", "Đề xuất chứa dữ liệu nhạy cảm hoặc vượt giới hạn.");
  }
  return db.transaction(() => {
    const existing = db.prepare("SELECT id FROM operator_tool_proposals WHERE kind = ? AND name = ? AND status = 'pending'")
      .get(proposal.kind, proposal.name) as { id: string } | undefined;
    if (existing) return { status: "duplicate", id: existing.id, name: proposal.name } as const;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const count = db.prepare("SELECT count(*) AS total FROM operator_tool_proposals WHERE created_at >= ?")
      .get(since) as { total: number };
    if (count.total >= 10) throw new AppError(429, "TOOL_PROPOSAL_LIMIT", "Đã đạt giới hạn đề xuất công cụ trong 24 giờ.");
    const id = randomUUID();
    db.prepare("INSERT INTO operator_tool_proposals (id, kind, name, details, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)")
      .run(id, proposal.kind, proposal.name, json, new Date().toISOString());
    return { status: "proposed", id, name: proposal.name } as const;
  }).immediate();
}

export function listToolProposals(db: Database.Database) {
  const rows = db.prepare(
    "SELECT id, details, created_at FROM operator_tool_proposals WHERE status = 'pending' ORDER BY created_at DESC, id LIMIT 50",
  ).all() as Array<{ id: string; details: string; created_at: string }>;
  return rows.map((row) => ({ id: row.id, ...ToolProposalArgs.parse(JSON.parse(row.details)), createdAt: row.created_at }));
}

export function dismissToolProposal(db: Database.Database, id: string): void {
  db.prepare("UPDATE operator_tool_proposals SET status = 'dismissed' WHERE id = ?").run(id);
}
