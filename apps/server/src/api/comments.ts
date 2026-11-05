import { CommentInboxQuerySchema, CommentSettingsInputSchema, CommentSettingsSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CommentInboxService } from "../comments/inboxService.js";

const IdParams = z.object({ id: z.string().uuid() }).strict();
const ReplyBody = z.object({ text: z.string().trim().min(1).max(300) }).strict();
const BulkSpamBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).strict();
const EnableBody = z.object({ enabled: z.boolean() }).strict();

export function registerCommentRoutes(app: FastifyInstance, comments: CommentInboxService): void {
  app.get("/api/comments", async (request) => {
    const query = CommentInboxQuerySchema.parse(request.query ?? {});
    return comments.list(query);
  });

  app.get("/api/comments/unread", async () => comments.unreadCount());

  app.post("/api/comments/bulk-spam", async (request) => {
    const body = BulkSpamBody.parse(request.body);
    return comments.bulkSpam(body.ids, request.signal);
  });

  app.post("/api/comments/:id/reply", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = ReplyBody.parse(request.body);
    await comments.reply(id, body.text, "user", request.signal);
    return { ok: true };
  });

  app.post("/api/comments/:id/hide", async (request) => {
    const { id } = IdParams.parse(request.params);
    await comments.hide(id, request.signal);
    return { ok: true };
  });

  app.post("/api/comments/:id/unhide", async (request) => {
    const { id } = IdParams.parse(request.params);
    await comments.unhide(id, request.signal);
    return { ok: true };
  });

  app.post("/api/comments/:id/spam", async (request) => {
    const { id } = IdParams.parse(request.params);
    await comments.markSpam(id, request.signal);
    return { ok: true };
  });

  app.post("/api/comments/:id/ignore", async (request) => {
    const { id } = IdParams.parse(request.params);
    comments.ignore(id);
    return { ok: true };
  });

  app.post("/api/comments/:id/read", async (request) => {
    const { id } = IdParams.parse(request.params);
    comments.markRead(id);
    return { ok: true };
  });

  app.delete("/api/comments/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    await comments.deleteComment(id, request.signal);
    return { ok: true };
  });

  app.get("/api/profiles/:id/comment-settings", async (request) => {
    const { id } = IdParams.parse(request.params);
    return comments.getSettings(id);
  });

  app.put("/api/profiles/:id/comment-settings", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = CommentSettingsInputSchema.parse(request.body ?? {});
    return CommentSettingsSchema.parse(comments.saveSettings(id, body));
  });

  app.put("/api/accounts/:id/comment-sync", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = EnableBody.parse(request.body);
    return comments.setCommentsEnabled(id, body.enabled);
  });
}
