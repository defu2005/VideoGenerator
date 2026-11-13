import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AccountHealth } from "./accountHealth.js";
import { AppError } from "../lib/errors.js";

const Payload = z.object({ client_key: z.string().min(1), event: z.string().max(100), create_time: z.number().int(),
  user_openid: z.string().min(1), content: z.string().max(20_000) });
type Credentials = { clientId: string; clientSecret: string };

/** TikTok HMAC over timestamp + '.' + exact request bytes, with a five-minute replay window.
 * https://developers.tiktok.com/docs/en/webhooks-verification (checked 2026-11-11).
 */
export function verifyTikTokSignature(body: Buffer, header: string, secret: string, now: Date): boolean {
  const parts = header.split(",").map(x => x.trim().split("="));
  const stamp = parts.find(x => x[0] === "t")?.[1];
  if (!stamp || !/^\d+$/.test(stamp) || Math.abs(now.getTime() / 1000 - Number(stamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(stamp + ".").update(body).digest();
  return parts.filter(x => x[0] === "s").some(x => {
    if (!/^[a-f0-9]{64}$/i.test(x[1] ?? "")) return false;
    return timingSafeEqual(expected, Buffer.from(x[1]!, "hex"));
  });
}

export function registerTikTokHealthWebhook(app: FastifyInstance, db: Database.Database,
  credentials: (accountId: string) => Credentials | null, now = () => new Date()): void {
  // Encapsulated raw-body parser: other app JSON routes keep their existing parser.
  void app.register(async scope => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 32_000 }, (_request, body, done) => done(null, body));
    scope.post("/api/knowledge/webhooks/tiktok", { bodyLimit: 32_000 }, async request => {
      if (!Buffer.isBuffer(request.body)) throw new AppError(400, "INVALID_WEBHOOK", "Webhook phải là JSON.");
      const raw = request.body;
      const payload = Payload.parse(JSON.parse(raw.toString("utf8")));
      const accounts = db.prepare("SELECT id FROM platform_accounts WHERE platform = 'tiktok' AND external_id = ?")
        .all(payload.user_openid) as Array<{ id: string }>;
      const signature = request.headers["tiktok-signature"];
      const valid = accounts.filter(account => {
        const creds = credentials(account.id);
        return creds?.clientId === payload.client_key && typeof signature === "string"
          && verifyTikTokSignature(raw, signature, creds.clientSecret, now());
      });
      if (!valid.length) throw new AppError(403, "WEBHOOK_SIGNATURE", "Không xác minh được webhook.");
      const content = z.record(z.string(), z.unknown()).parse(JSON.parse(payload.content));
      const health = new AccountHealth(db, now);
      const seen = JSON.parse(health.inbox.setting("change.tiktok.webhookSeen") ?? "{}") as Record<string, number>;
      const hash = createHash("sha256").update(raw).digest("hex");
      if (seen[hash]) return { received: true, duplicate: true };
      for (const account of valid) {
        const orderingKey = `change.webhookOrder:${account.id}`;
        const order = JSON.parse(health.inbox.setting(orderingKey) ?? "{}") as Record<string, number>;
        const assetKey = typeof content.publish_id === "string" ? content.publish_id : typeof content.post_id === "string" ? content.post_id : "account";
        const orderKey = payload.event === "authorization.removed" ? "authorization" : `publish:${assetKey}`;
        if ((order[orderKey] ?? -Infinity) > payload.create_time) continue;
        order[orderKey] = payload.create_time;
        health.inbox.putSetting(orderingKey, JSON.stringify(Object.fromEntries(Object.entries(order).slice(-1000))));
        if (payload.event === "authorization.removed") {
          health.observe(account.id, { entryId: "account.tiktok.revoke", source: "api", state: "issue",
            detail: `Webhook xác nhận quyền kết nối đã bị gỡ; reason=${String(content.reason).slice(0, 10)}. Không suy thành ban.` });
          health.observe(account.id, { entryId: "account.tiktok.suspension", source: "api", state: content.reason === 4 ? "issue" : "unknown",
            detail: content.reason === 4 ? "Webhook reason=4 xác nhận tài khoản bị ban." : "Webhook không xác nhận tài khoản bị ban." });
        } else if (payload.event.startsWith("post.publish.")) {
          const ids = [content.post_id, content.publish_id].filter((x): x is string => typeof x === "string");
          const pubs = db.prepare("SELECT id, external_id FROM publications WHERE account_id = ? AND external_id IS NOT NULL")
            .all(account.id) as Array<{ id: string; external_id: string }>;
          const pub = pubs.find(x => ids.includes(x.external_id));
          const visibility = payload.event === "post.publish.no_longer_publicaly_available";
          const completed = ["post.publish.complete", "post.publish.publicly_available"].includes(payload.event);
          if (visibility || completed || payload.event === "post.publish.failed") health.observe(account.id, {
            entryId: visibility ? "account.tiktok.removal" : "account.tiktok.upload", assetId: pub?.id, source: "api",
            state: visibility || !pub ? "unknown" : completed ? "clear" : "issue",
            detail: visibility ? "Bài không còn công khai; chưa rõ là đổi quyền riêng tư, xoá hay moderation." : pub ? `Webhook ${payload.event}` : "Có webhook publish nhưng chưa ghép được video; cần kiểm tra.",
          });
        }
      }
      const recent = Object.entries(seen).filter(([, time]) => now().getTime() - time < 7 * 86_400_000).slice(-999);
      health.inbox.putSetting("change.tiktok.webhookSeen", JSON.stringify(Object.fromEntries([...recent, [hash, now().getTime()]])));
      return { received: true };
    });
  });
}
