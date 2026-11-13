import type Database from "better-sqlite3";
import { z } from "zod";
import type { KnowledgeEntry } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { ChangeInbox } from "./changeInbox.js";
import { KnowledgeService } from "./service.js";
import { EligibilityMetricsSchema, Milestones } from "./milestones.js";

export const ManualHealthSchema = z.object({
  accountId: z.string().min(1), entryId: z.string().min(1), assetId: z.string().max(200).optional(),
  outcome: z.enum(["clear", "issue"]), policyName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).default(""),
  eligibility: EligibilityMetricsSchema.optional(),
}).strict().refine(x => x.outcome === "clear" || Boolean(x.policyName), "Ghi tên chính sách khi có vấn đề.");
export type HealthObservation = {
  entryId: string; assetId?: string; state: "clear" | "issue" | "unknown";
  detail: string; source: "api" | "manual"; checkedAt?: string;
};
type Account = { id: string; platform: string; display_name: string; profile_id: string };
type PolicyValue = { platform: string; name: string; signal: string; coverage: "api" | "partial" | "manual"; verification: string };
type SavedObservation = HealthObservation & { checkedAt: string };

/** Status/check history lives in bounded app_settings records; facts still come from the resolver. */
export class AccountHealth {
  readonly inbox: ChangeInbox;
  readonly knowledge: KnowledgeService;
  constructor(private readonly db: Database.Database, private readonly now = () => new Date()) {
    this.inbox = new ChangeInbox(db, now); this.knowledge = new KnowledgeService(db, now);
  }
  accounts(): Account[] {
    return this.db.prepare("SELECT id, platform, display_name, profile_id FROM platform_accounts WHERE connection = 'CONNECTED'").all() as Account[];
  }
  policies(platform: string): Array<{ entry: KnowledgeEntry; value: PolicyValue }> {
    const name = platform.replace(/_reels$/, "");
    return this.knowledge.list({ kind: "account_policy", platform: name }).map(({ entry }) => ({ entry, value: entry.value as PolicyValue }));
  }
  checklist() {
    const at = this.now().getTime();
    return this.accounts().map(account => ({
      accountId: account.id, platform: account.platform, name: account.display_name,
      checks: this.policies(account.platform).map(({ entry, value }) => {
        const observations = this.saved(account.id).filter(x => x.entryId === entry.id);
        const manual = observations.filter(x => x.source === "manual").at(-1);
        return { entryId: entry.id, ...value, sources: entry.evidence, observations: observations.slice(-20),
          due: (value.coverage !== "api" || observations.at(-1)?.state === "unknown") && (!manual || at - Date.parse(manual.checkedAt) >= 7 * 86_400_000) };
      }),
    }));
  }
  observe(accountId: string, input: HealthObservation) {
    const account = this.db.prepare("SELECT id, platform, display_name, profile_id FROM platform_accounts WHERE id = ?").get(accountId) as Account | undefined;
    if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Không thấy tài khoản.");
    const policy = this.policies(account.platform).find(x => x.entry.id === input.entryId);
    if (!policy) throw new AppError(400, "HEALTH_POLICY_UNKNOWN", "Không có mục tri thức trạng thái cho tài khoản này.");
    // Manual-only fields cannot be asserted by API adapters, including after a missing resource.
    const state = input.source === "api" && policy.value.coverage === "manual" ? "unknown" : input.state;
    const checkedAt = this.now().toISOString();
    const observation: SavedObservation = { ...input, state, detail: input.detail.slice(0, 500), checkedAt };
    const key = input.source === "manual" ? `change.health.manual:${accountId}` : `change.health.${accountId}`;
    const history = (JSON.parse(this.inbox.setting(key) ?? "[]") as SavedObservation[])
      .filter(x => Date.parse(x.checkedAt) >= this.now().getTime() - 366 * 86_400_000);
    this.inbox.putSetting(key, JSON.stringify([...history, observation].slice(-1000)));
    const evidence = { entryId: input.entryId, accountId, assetId: input.assetId ?? null, state,
      detail: observation.detail, checkedAt, sources: policy.entry.evidence };
    const fingerprint = `health:${accountId}:${input.entryId}:${input.assetId ?? "account"}:${state}`;
    if (state === "clear") {
      for (const event of this.inbox.list({ status: "open" })) {
        if (event.detector !== "D3") continue;
        const old = event.evidence as typeof evidence;
        if (old.accountId === accountId && old.entryId === input.entryId && old.assetId === evidence.assetId) this.inbox.resolve(event.id);
      }
      if (input.source !== "manual") return observation;
    }
    const accountSignal = ["strikes", "suspension", "revoke"].includes(policy.value.signal);
    const critical = state === "issue" && accountSignal;
    this.inbox.record({
      category: accountSignal ? "E1" : "E2", detector: input.source === "manual" ? "D7" : "D3",
      subject: input.assetId && !accountSignal ? { type: "video", id: input.assetId } : { type: "account", id: accountId },
      summary: `${account.display_name}: ${policy.value.name} — ${state === "unknown" ? "chưa rõ, cần kiểm tra" : state === "clear" ? "đã kiểm, không có vấn đề" : "có vấn đề đã xác nhận"}`,
      evidence, severity: critical ? "critical" : state === "issue" ? "high" : "info",
      fingerprint: input.source === "manual" ? `${fingerprint}:${checkedAt.slice(0, 10)}` : fingerprint,
    });
    return observation;
  }
  manual(raw: unknown) {
    const input = ManualHealthSchema.parse(raw);
    if (input.assetId) {
      const owned = this.db.prepare("SELECT id FROM publications WHERE account_id = ? AND (id = ? OR external_id = ?)")
        .get(input.accountId, input.assetId, input.assetId) as { id: string } | undefined;
      if (!owned) throw new AppError(400, "HEALTH_ASSET_MISMATCH", "Video không thuộc tài khoản đã chọn.");
      input.assetId = owned.id;
    }
    const observation = this.observe(input.accountId, {
      entryId: input.entryId, assetId: input.assetId, state: input.outcome === "issue" ? "issue" : "clear", source: "manual",
      detail: [input.policyName, input.note].filter(Boolean).join(": "),
    });
    if (input.eligibility) new Milestones(this.db, this.now).saveManual(input.accountId, input.eligibility);
    return observation;
  }
  private saved(accountId: string): SavedObservation[] {
    return [...JSON.parse(this.inbox.setting(`change.health.${accountId}`) ?? "[]"),
      ...JSON.parse(this.inbox.setting(`change.health.manual:${accountId}`) ?? "[]")].sort((a: SavedObservation, b: SavedObservation) => a.checkedAt.localeCompare(b.checkedAt)) as SavedObservation[];
  }
}

/** An API error is an access/sync uncertainty, never proof of enforcement. */
export function unknownHealth(entryId: string, assetId?: string): HealthObservation {
  return { entryId, assetId, state: "unknown", source: "api", detail: "Không đọc được trạng thái; đối chiếu trong nền tảng." };
}

