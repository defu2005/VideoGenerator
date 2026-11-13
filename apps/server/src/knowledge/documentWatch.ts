import {
  classifyDocument, newFeedItems, npmFindings, watchHash, type EventSeverity,
} from "@vg/shared";
import type { KnowledgeEntry } from "@vg/shared";
import { quoteInPage } from "@vg/shared";
import { ChangeInbox } from "./changeInbox.js";
import { KnowledgeService } from "./service.js";

export type WatchFetch = (url: string) => Promise<{ status: number; url: string; text: string; canonical?: string | null }>;
export type WatchModel = (page: string, context?: { entryId: string; url: string }) => Promise<{
  effect: "none" | "change";
  quote?: string;
  summary?: string;
  proposal?: KnowledgeEntry;
}>;

type WatchState = { hash: string | null; canonical: string | null; items: string[]; checkedAt: string | null };

export async function runDocumentWatch(inbox: ChangeInbox, input: {
  url: string;
  kind: "policy_page" | "changelog" | "rss" | "api_revision";
  category: string;
  subjectId: string;
  fetch: WatchFetch;
  llm?: WatchModel;
  eco?: boolean;
  robotsBlocked?: boolean;
}): Promise<{ class: string; llm: "skipped" | "read" | "none" }> {
  const stateKey = `${input.subjectId}:${input.url}`;
  const state = readState(inbox, stateKey, input.url);
  if (input.robotsBlocked) {
    inbox.record({
      category: input.category, detector: "D7", subject: { type: "knowledge", id: input.subjectId },
      summary: `Trang ${input.url} bị robots hoặc 403, cần đối chiếu tay`,
      evidence: { url: input.url }, severity: "info", fingerprint: `d7:manual:${input.url}`,
    });
    return { class: "manual", llm: "none" };
  }
  const page = await input.fetch(input.url);
  const nowIso = new Date().toISOString();
  if (page.status >= 200 && page.status < 300 && page.url === input.url && (input.kind === "rss" || input.kind === "api_revision")) {
    const fresh = newFeedItems(page.text, state.items);
    writeState(inbox, stateKey, { hash: watchHash(page.text), canonical: page.canonical ?? null, items: [...state.items, ...fresh], checkedAt: nowIso });
    if (fresh.length === 0) return { class: "unchanged", llm: "none" };
    return readChange(inbox, input, page.text, fresh.join("\n"));
  }
  const verdict = classifyDocument({
    status: page.status, requestedUrl: input.url, finalUrl: page.url, text: page.text,
    previousHash: state.hash, canonical: page.canonical, previousCanonical: state.canonical,
  });
  writeState(inbox, stateKey, { hash: watchHash(page.text), canonical: page.canonical ?? state.canonical, items: state.items, checkedAt: nowIso });
  if (verdict === "unchanged") return { class: verdict, llm: "none" };
  if (verdict === "manual") {
    inbox.record({
      category: input.category, detector: "D7", subject: { type: "knowledge", id: input.subjectId },
      summary: `Trang ${input.url} cần đối chiếu tay`, evidence: { url: input.url, status: page.status },
      severity: "info", fingerprint: `d7:manual:${input.url}`,
    });
    return { class: verdict, llm: "none" };
  }
  if (verdict === "g1" || verdict === "g2") {
    inbox.record({
      category: verdict === "g1" ? "G1" : "G2", detector: "D1",
      subject: { type: "knowledge", id: input.subjectId },
      summary: verdict === "g1" ? `Nguồn ${input.url} mất hoặc đổi đường dẫn` : `Nguồn ${input.url} chỉ còn vỏ hoặc đổi canonical`,
      evidence: { url: input.url, finalUrl: page.url, status: page.status },
      severity: "high", fingerprint: `d1:${verdict}:${input.url}`,
    });
    return { class: verdict, llm: "none" };
  }
  return readChange(inbox, input, page.text, page.text);
}

function readChange(inbox: ChangeInbox, input: {
  url: string; category: string; subjectId: string; llm?: WatchModel; eco?: boolean;
}, pageText: string, prompt: string): { class: "changed"; llm: "skipped" | "read" } {
  const mode = inbox.llmBudget(input.eco === true);
  if (mode === "hash" || !input.llm) {
    inbox.record({
      category: input.category, detector: "D1", subject: { type: "knowledge", id: input.subjectId },
      summary: input.eco ? `ECO chỉ lưu hash của ${input.url}` : `Trang ${input.url} đổi, chưa đọc vì hết ngân sách`,
      evidence: { url: input.url }, severity: "info", fingerprint: `d1:hash:${input.url}`,
    });
    return { class: "changed", llm: "skipped" };
  }
  return { class: "changed", llm: "read" };
}

export async function readChangedPage(inbox: ChangeInbox, input: {
  url: string; category: string; subjectId: string; pageText: string; llm: WatchModel;
}): Promise<"none" | "low" | "proposed"> {
  inbox.spendLlm();
  const answer = await input.llm(input.pageText, { entryId: input.subjectId, url: input.url });
  if (answer.effect === "none") {
    inbox.record({
      category: input.category, detector: "D1", subject: { type: "knowledge", id: input.subjectId },
      summary: `Trang ${input.url} đổi nhưng không ảnh hưởng`,
      evidence: { url: input.url }, severity: "info", fingerprint: `d1:none:${input.url}`,
    });
    return "none";
  }
  const quote = answer.quote ?? "";
  if (!quote || quote.trim().split(/\s+/).length > 25 || !quoteInPage(input.pageText, quote)) {
    inbox.record({
      category: input.category, detector: "D1", subject: { type: "knowledge", id: input.subjectId },
      summary: answer.summary ?? `Trang ${input.url} có dấu hiệu đổi nhưng câu trích không khớp`,
      evidence: { url: input.url, quote, confidence: "low" }, severity: "warn", fingerprint: `d1:low:${input.url}`,
    });
    return "low";
  }
  const current = new KnowledgeService(inbox.database()).get(input.subjectId)?.entry;
  const proposal = answer.proposal?.id === input.subjectId && answer.proposal.kind === current?.kind
    ? { ...answer.proposal, evidence: [{ url: input.url, quote, checkedAt: new Date().toISOString().slice(0, 10), type: "official" as const }] } : undefined;
  inbox.record({
    category: input.category, detector: "D1", subject: { type: "knowledge", id: input.subjectId },
    summary: answer.summary ?? `Trang ${input.url} đề xuất giá trị mới`,
    evidence: { url: input.url, quote, confidence: "high" }, severity: "high", fingerprint: `d1:quote:${input.subjectId}:${input.url}`,
    proposal,
  });
  return proposal ? "proposed" : "low";
}

export async function runDocumentWatchFull(inbox: ChangeInbox, input: {
  url: string; kind: "policy_page" | "changelog" | "rss" | "api_revision"; category: string; subjectId: string;
  fetch: WatchFetch; llm?: WatchModel; eco?: boolean; robotsBlocked?: boolean;
}): Promise<{ class: string; llm: "skipped" | "read" | "none"; reading?: "none" | "low" | "proposed" }> {
  const first = await runDocumentWatch(inbox, input);
  if (first.llm !== "read" || !input.llm) return first;
  const page = await input.fetch(input.url);
  const reading = await readChangedPage(inbox, { ...input, pageText: page.text, llm: input.llm });
  return { ...first, reading };
}

export function runDependencySweep(inbox: ChangeInbox, outdated: unknown, audit: unknown): number {
  let count = 0;
  for (const finding of npmFindings(outdated, audit)) {
    inbox.recordDependency(finding.name, finding.summary, finding.severity);
    count += 1;
  }
  return count;
}

export function dependencyCommands(): { outdated: string; audit: string } {
  return { outdated: "npm outdated --json", audit: "npm audit --json" };
}

export function assertReadOnlyNpm(command: string): void {
  if (!/^npm (outdated|audit) --json$/.test(command)) {
    throw new Error("Chỉ đọc npm outdated hoặc npm audit.");
  }
}

function readState(inbox: ChangeInbox, url: string, legacyUrl?: string): WatchState {
  const raw = inbox.setting("change.watches");
  if (!raw) return { hash: null, canonical: null, items: [], checkedAt: null };
  const all = JSON.parse(raw) as Record<string, WatchState>;
  return all[url] ?? (legacyUrl ? all[legacyUrl] : undefined) ?? { hash: null, canonical: null, items: [], checkedAt: null };
}

function writeState(inbox: ChangeInbox, url: string, state: WatchState): void {
  const raw = inbox.setting("change.watches");
  const all = raw ? JSON.parse(raw) as Record<string, WatchState> : {};
  all[url] = state;
  inbox.putSetting("change.watches", JSON.stringify(all));
}

export type { EventSeverity };
