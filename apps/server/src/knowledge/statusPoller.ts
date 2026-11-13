import type Database from "better-sqlite3";
import type { PlatformId, TokenSet } from "@vg/shared";
import type { TokenVault } from "../publishing/tokenVault.js";
import type { PublisherRegistry } from "../publishing/registry.js";
import type { YoutubeQuotaTracker } from "../publishing/youtubeQuota.js";
import { META_GRAPH_BASE } from "../publishing/metaGraph.js";
import { AccountHealth, type HealthObservation } from "./accountHealth.js";
import { noteExternalHttp, withExternalHttpAccount } from "./httpSignal.js";
import { Milestones } from "./milestones.js";

const obj = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
type Pub = { id: string; external_id: string; external_url: string | null };
type PollDeps = {
  db: Database.Database; vault: Pick<TokenVault, "loadTokens" | "storeTokens" | "loadAppCredentials">;
  registry: Pick<PublisherRegistry, "get">; quota?: YoutubeQuotaTracker;
  fetch?: typeof fetch; now?: () => Date;
  metaCredentials?: (accountId: string) => { appId: string; appSecret: string };
};

class StatusAccessError extends Error {
  constructor(readonly code: "graph190") { super(code); }
}

/** Transport adapters know payload shapes. Coverage and verification instructions remain resolver data. */
export class StatusPoller {
  private readonly health: AccountHealth;
  private readonly now: () => Date;
  constructor(private readonly deps: PollDeps) {
    this.now = deps.now ?? (() => new Date()); this.health = new AccountHealth(deps.db, this.now);
  }
  async poll(signal: AbortSignal): Promise<void> {
    for (const account of this.health.accounts()) {
      if (signal.aborted) return;
      new Milestones(this.deps.db, this.now).check(account.id);
      const policies = this.health.policies(account.platform).filter(x => x.value.coverage !== "manual" && x.value.signal !== "eligibility");
      if (!policies.length) continue;
      const push = (key: string, state: HealthObservation["state"], assetId?: string, detail = "Đối chiếu trong nền tảng.") => {
        const policy = policies.find(x => x.value.signal === key);
        if (policy) this.health.observe(account.id, { entryId: policy.entry.id, state, assetId, source: "api", detail });
      };
      let tokens: TokenSet | null;
      try {
        tokens = this.deps.vault.loadTokens(account.id);
        if (tokens?.expiresAt && Date.parse(tokens.expiresAt) <= this.now().getTime() + 300_000) {
          const publisher = this.deps.registry.get(account.platform as PlatformId);
          if (!publisher) throw new Error("No adapter");
          const current = tokens;
          tokens = await withExternalHttpAccount(account.id, () => publisher.oauth.refresh(current, signal, account.id));
          this.deps.vault.storeTokens(account.id, tokens, tokens.scopes);
        }
      } catch { tokens = null; }
      if (!tokens) { push("revoke", "unknown"); continue; }
      try {
        const publisher = this.deps.registry.get(account.platform as PlatformId);
        if (publisher) { await withExternalHttpAccount(account.id, () => publisher.oauth.fetchIdentity(tokens!, signal)); push("revoke", "clear", undefined, "Đọc được danh tính bằng kết nối hiện tại."); }
      } catch { push("revoke", "unknown"); }
      if (account.platform === "facebook_reels" && this.deps.metaCredentials) {
        try {
          const creds = this.deps.metaCredentials(account.id);
          const url = new URL(`${META_GRAPH_BASE}/debug_token`);
          url.searchParams.set("input_token", tokens.accessToken);
          const data = obj((await this.request(url, { ...tokens, accessToken: `${creds.appId}|${creds.appSecret}` }, signal)).data);
          push("revoke", data.is_valid === true ? "clear" : "unknown", undefined,
            data.is_valid === false ? "debug_token: kết nối không hợp lệ; cần kết nối lại, chưa rõ lý do." : "Đối chiếu is_valid của debug_token.");
        } catch { push("revoke", "unknown", undefined, "Không đọc được debug_token; kiểm tra kết nối."); }
      }
      const pubs = this.deps.db.prepare("SELECT id, external_id, external_url FROM publications WHERE account_id = ? AND external_id IS NOT NULL AND status IN ('PUBLISHED', 'UPLOADING', 'FAILED')")
        .all(account.id) as Pub[];
      if (account.platform === "youtube") {
        for (let i = 0; i < pubs.length && !signal.aborted; i += 50) {
          const batch = pubs.slice(i, i + 50);
          try {
            if (this.deps.quota && !this.deps.quota.charge("videos.list")) throw new Error("Quota");
            const url = new URL("https://www.googleapis.com/youtube/v3/videos");
            url.searchParams.set("part", "status,processingDetails,contentDetails"); url.searchParams.set("id", batch.map(x => x.external_id).join(","));
            const data = await this.request(url, tokens, signal);
            const items = Array.isArray(data.items) ? data.items.map(obj) : [];
            for (const pub of batch) {
              const item = items.find(x => x.id === pub.external_id);
              for (const observation of youtubeStatus(item, pub.id)) push(observation.signal, observation.state, pub.id, observation.detail);
            }
          } catch { for (const pub of batch) for (const key of ["upload", "removal", "age", "region"]) push(key, "unknown", pub.id); }
        }
        continue;
      }
      for (const pub of pubs) {
        if (signal.aborted) return;
        try {
          if (account.platform === "tiktok") {
            if (pub.external_url?.includes("/video/")) {
              const data = await this.request(new URL("https://open.tiktokapis.com/v2/video/query/?fields=id"), tokens, signal, { filters: { video_ids: [pub.external_id] } });
              const videos = obj(data.data).videos;
              push("removal", "unknown", pub.id, Array.isArray(videos) && videos.length ? "Video còn đọc được; API không xác nhận lý do moderation." : "Không thấy video; chưa rõ lý do.");
            } else {
              const data = await this.request(new URL("https://open.tiktokapis.com/v2/post/publish/status/fetch/"), tokens, signal, { publish_id: pub.external_id });
              const status = obj(data.data).status;
              push("upload", status === "FAILED" ? "issue" : status === "PUBLISH_COMPLETE" ? "clear" : "unknown", pub.id, `Trạng thái publish: ${typeof status === "string" ? status.slice(0, 80) : "chưa rõ"}`);
            }
          } else if (account.platform === "facebook_reels") {
            const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(pub.external_id.replace(/^pending:/, ""))}`); url.searchParams.set("fields", "status");
            const data = await this.request(url, tokens, signal);
            push("upload", facebookVideoStatus(data.status), pub.id);
            push("removal", "unknown", pub.id, "Video status không xác nhận quyết định gỡ hoặc nguyên nhân.");
          } else if (account.platform === "instagram_reels") {
            const pending = pub.external_id.startsWith("pending:");
            const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(pub.external_id.replace(/^pending:/, ""))}`);
            url.searchParams.set("fields", pending ? "status_code,status" : "id");
            const data = await this.request(url, tokens, signal), status = data.status_code;
            push("upload", pending ? status === "ERROR" || status === "EXPIRED" ? "issue" : status === "PUBLISHED" || status === "FINISHED" ? "clear" : "unknown" : data.id ? "clear" : "unknown", pub.id,
              "Trạng thái container khác với trạng thái moderation của bài đã đăng.");
            push("removal", "unknown", pub.id);
          }
        } catch (error) {
          if (error instanceof StatusAccessError) push("revoke", "unknown", undefined, "Graph code 190: token không hợp lệ/đã hết hạn; cần kiểm tra kết nối, không xác nhận ban.");
          push("upload", "unknown", pub.id); push("removal", "unknown", pub.id);
        }
      }
    }
  }
  private async request(url: URL, tokens: TokenSet, signal: AbortSignal, body?: unknown): Promise<Record<string, unknown>> {
    const response = await (this.deps.fetch ?? fetch)(url, {
      method: body ? "POST" : "GET", headers: { authorization: `Bearer ${tokens.accessToken}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error",
    });
    noteExternalHttp({ provider: "account-health", endpoint: url.origin + url.pathname, status: response.status });
    const data = obj(await response.json());
    if (url.hostname === "graph.facebook.com" && obj(data.error).code === 190) throw new StatusAccessError("graph190");
    if (!response.ok) throw new Error("Status unavailable");
    if (data.error && obj(data.error).code && obj(data.error).code !== "ok") throw new Error("API error");
    return data;
  }
}

export function facebookVideoStatus(raw: unknown): HealthObservation["state"] {
  const status = obj(raw);
  if (status.video_status === "error" || ["uploading_phase", "processing_phase", "publishing_phase"].some(key => obj(status[key]).status === "error")) return "issue";
  return status.video_status === "ready" ? "clear" : "unknown";
}

export function youtubeStatus(raw: unknown, assetId: string) {
  const item = obj(raw), status = obj(item.status), details = obj(item.contentDetails);
  const results: Array<{ signal: string; state: HealthObservation["state"]; detail: string }> = [];
  const add = (signal: string, state: HealthObservation["state"], detail: string) => results.push({ signal, state, detail });
  if (!item.id) return ["upload", "removal", "region", "age"].map(signal => ({ signal, state: "unknown" as const, detail: `Không thấy video ${assetId}; chưa rõ nguyên nhân.` }));
  add("upload", ["failed", "rejected"].includes(String(status.uploadStatus)) || obj(item.processingDetails).processingStatus === "failed" ? "issue" : status.uploadStatus === "processed" ? "clear" : "unknown", "Chỉ diễn giải trạng thái upload/processing, không coi là strike.");
  add("removal", status.uploadStatus === "deleted" ? "issue" : "unknown", "Chỉ trạng thái deleted tường minh xác nhận video bị xoá; không suy lý do enforcement.");
  const regions = obj(details.regionRestriction);
  add("region", Array.isArray(regions.allowed) || Array.isArray(regions.blocked) && regions.blocked.length > 0 ? "issue" : item.contentDetails ? "clear" : "unknown", "Giới hạn vùng từ contentDetails.regionRestriction.");
  const age = obj(details.contentRating).ytRating;
  add("age", age === "ytAgeRestricted" ? "issue" : "unknown", "API chỉ xác nhận khi có ytAgeRestricted.");
  return results;
}
