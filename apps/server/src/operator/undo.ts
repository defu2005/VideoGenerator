import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";

type UndoPayload =
  | { type: "settings"; key: string; value: string }
  | { type: "topic"; id: string; status: string }
  | { type: "publish"; publicationId: string; externalId?: string | null }
  | { type: "comment_reply"; commentId: string }
  | { type: "comment_hide"; commentId: string }
  | { type: "gate"; projectId: string; stage: string };

const STAGE_ORDER = ["RESEARCH", "SCRIPT", "SCENES", "VISUALS", "VOICE", "TIMELINE", "RENDER", "METADATA", "PUBLISH"];

export function undoAudit(sqlite: Database.Database, id: string, hooks?: {
  setPrivate?: (externalId: string) => void;
  now?: Date;
}): { undone: true; tool: string; detail: string } {
  const row = sqlite.prepare("SELECT id, tool, summary, undo FROM operator_tool_audit WHERE id = ?")
    .get(id) as { id: string; tool: string; summary: string; undo: string | null } | undefined;
  if (!row) throw new AppError(404, "AUDIT", "Không thấy thao tác.");
  if (row.summary.includes("đã hoàn tác")) throw new AppError(409, "UNDO", "Thao tác này đã hoàn tác.");
  if (!row.undo) throw new AppError(409, "UNDO", "Thao tác này không có cách hoàn tác.");
  const payload = (typeof row.undo === "string" ? JSON.parse(row.undo) : row.undo) as UndoPayload;
  const detail = applyUndo(sqlite, payload, hooks);
  sqlite.prepare("UPDATE operator_tool_audit SET summary = summary || ' · đã hoàn tác' WHERE id = ?").run(id);
  return { undone: true, tool: row.tool, detail };
}

function applyUndo(sqlite: Database.Database, payload: UndoPayload, hooks?: { setPrivate?: (externalId: string) => void; now?: Date }): string {
  const at = (hooks?.now ?? new Date()).toISOString();
  if (payload.type === "settings") {
    sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(payload.key, payload.value, at);
    return "Đã khôi phục cấu hình.";
  }
  if (payload.type === "topic") {
    sqlite.prepare("UPDATE profile_topics SET status = ? WHERE id = ?").run(payload.status, payload.id);
    return "Đã đảo trạng thái chủ đề.";
  }
  if (payload.type === "publish") {
    const row = sqlite.prepare("SELECT external_id FROM publications WHERE id = ?").get(payload.publicationId) as { external_id: string | null } | undefined;
    if (!row) throw new AppError(404, "UNDO", "Không thấy bài đăng.");
    sqlite.prepare(`UPDATE publications SET status = 'CANCELLED', visibility_used = 'private', guardrail_reason = 'withdrawn', updated_at = ?
      WHERE id = ?`).run(at, payload.publicationId);
    const externalId = payload.externalId ?? row.external_id;
    if (externalId) hooks?.setPrivate?.(externalId);
    return "Đã chuyển bài về riêng tư và đánh dấu rút lại.";
  }
  if (payload.type === "comment_reply") {
    sqlite.prepare("UPDATE comments SET reply_external_id = NULL, status = 'read' WHERE id = ?").run(payload.commentId);
    return "Đã gỡ trả lời do app đăng.";
  }
  if (payload.type === "comment_hide") {
    sqlite.prepare("UPDATE comments SET status = 'read' WHERE id = ?").run(payload.commentId);
    return "Đã hiện lại bình luận.";
  }
  if (payload.type === "gate") {
    const index = STAGE_ORDER.indexOf(payload.stage);
    const later = index >= 0 ? STAGE_ORDER.slice(index + 1) : [];
    if (later.length) {
      const placeholders = later.map(() => "?").join(",");
      const started = sqlite.prepare(`SELECT 1 FROM project_stages WHERE project_id = ? AND stage IN (${placeholders})
        AND state IN ('RUNNING', 'DONE', 'APPROVED') LIMIT 1`).get(payload.projectId, ...later);
      if (started) throw new AppError(409, "UNDO", "Bước sau đã chạy, không mở lại cổng.");
    }
    sqlite.prepare("UPDATE project_stages SET state = 'WAITING_USER' WHERE project_id = ? AND stage = ?")
      .run(payload.projectId, payload.stage);
    return "Đã mở lại cổng.";
  }
  throw new AppError(409, "UNDO", "Không rõ cách hoàn tác.");
}
