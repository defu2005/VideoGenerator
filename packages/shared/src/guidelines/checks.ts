import type { AspectRatio, LicenseKind } from "../enums.js";
import type { Script } from "../schemas/script.js";
import type { Timeline } from "../schemas/timeline.js";
import type { ActiveGuidelineRule, ActiveGuidelines } from "./resolve.js";
import type { GuidelineSeverity } from "./schema.js";

export type GuidelineFindingDraft = {
  ruleId: string;
  severity: GuidelineSeverity;
  sceneId: string | null;
  text: string;
  quote: string | null;
  suggestion: string | null;
};

const RISKY_LICENSES: readonly LicenseKind[] = [
  "UNKNOWN",
  "ALL_RIGHTS_RESERVED",
  "CC_BY_NC",
  "CC_BY_NC_SA",
  "CC_BY_NC_ND",
];

function firstRule(active: ActiveGuidelines, kind: string): ActiveGuidelineRule | undefined {
  return active.rules.find((rule) => rule.check?.kind === kind);
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function seconds(text: string, wordsPerMinute: number): number {
  return (words(text) / wordsPerMinute) * 60;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?[.!?…])(\s|$)/su.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word matches, ignoring case, with Unicode letters (so Vietnamese works). */
export function findBlockedWords(text: string, blocked: readonly string[]): string[] {
  const found: string[] = [];
  for (const word of blocked) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu");
    if (pattern.test(text)) found.push(word);
  }
  return found;
}

function durationFinding(active: ActiveGuidelines, durationSec: number, label: string): GuidelineFindingDraft[] {
  const max = active.params.maxDurationSec;
  const rule = firstRule(active, "maxDuration");
  if (!rule || max === undefined || durationSec <= max) return [];
  return [{
    ruleId: rule.key,
    severity: rule.severity,
    sceneId: null,
    text: `${label} ${Math.round(durationSec)} giây, vượt giới hạn ${max} giây (${rule.packName}).`,
    quote: null,
    suggestion: `Rút gọn lời dẫn hoặc đặt thời lượng mục tiêu ≤ ${max} giây.`,
  }];
}

function aspectFinding(active: ActiveGuidelines, aspectRatio: AspectRatio): GuidelineFindingDraft[] {
  const allowed = active.params.aspectRatios;
  const rule = firstRule(active, "aspectRatio");
  if (!rule || !allowed || allowed.includes(aspectRatio)) return [];
  return [{
    ruleId: rule.key,
    severity: rule.severity,
    sceneId: null,
    text: `Khung hình ${aspectRatio} không thuộc ${allowed.join(", ")} mà ${rule.packName} khuyến nghị.`,
    quote: null,
    suggestion: `Đổi khung hình của dự án sang ${allowed[0]}.`,
  }];
}

/** Code checks run after SCRIPT. They never call an LLM. */
export function checkScriptGuidelines(
  active: ActiveGuidelines,
  script: Script,
  options: { wordsPerMinute: number; aspectRatio: AspectRatio },
): GuidelineFindingDraft[] {
  const findings: GuidelineFindingDraft[] = [];
  const allText = [script.hook, ...script.sections.map((section) => section.narration), script.outro].join(" ");
  findings.push(...durationFinding(active, seconds(allText, options.wordsPerMinute), "Lời dẫn ước tính dài"));
  findings.push(...aspectFinding(active, options.aspectRatio));

  const hookRule = firstRule(active, "hook");
  const hookLimit = active.params.hookWithinSec;
  if (hookRule && hookLimit !== undefined) {
    const opening = script.hook.trim() || script.sections[0]?.narration || "";
    const sentence = firstSentence(opening);
    const hookSec = seconds(sentence, options.wordsPerMinute);
    if (sentence && hookSec > hookLimit) {
      findings.push({
        ruleId: hookRule.key,
        severity: hookRule.severity,
        sceneId: script.hook.trim() ? null : script.sections[0]?.id ?? null,
        text: `Câu mở đầu mất khoảng ${hookSec.toFixed(1)} giây để đọc, quá ${hookLimit} giây (${hookRule.packName}).`,
        quote: sentence.slice(0, 400),
        suggestion: "Rút câu đầu thành một ý ngắn, gây tò mò.",
      });
    }
  }

  const parts: { sceneId: string | null; text: string }[] = [
    { sceneId: null, text: `${script.title}\n${script.hook}` },
    ...script.sections.map((section) => ({ sceneId: section.id, text: `${section.heading}\n${section.narration}` })),
    { sceneId: null, text: script.outro },
  ];
  for (const rule of active.rules) {
    if (rule.check?.kind !== "blockedWords") continue;
    if (!rule.appliesTo.some((target) => target === "script" || target === "subtitles" || target === "metadata")) continue;
    for (const part of parts) {
      const found = findBlockedWords(part.text, rule.check.words);
      if (!found.length) continue;
      findings.push({
        ruleId: rule.key,
        severity: rule.severity,
        sceneId: part.sceneId,
        text: `Có từ cần tránh: ${found.join(", ")} (${rule.packName}).`,
        quote: found.join(", "),
        suggestion: "Thay bằng từ nhẹ hơn hoặc bỏ đi.",
      });
    }
  }
  return dedupe(findings);
}

/** Code checks run after TIMELINE. They never call an LLM. */
export function checkTimelineGuidelines(
  active: ActiveGuidelines,
  timeline: Timeline,
  options: { aspectRatio: AspectRatio },
): GuidelineFindingDraft[] {
  const findings: GuidelineFindingDraft[] = [];
  findings.push(...durationFinding(active, timeline.totalDurationSec, "Video dài"));
  findings.push(...aspectFinding(active, options.aspectRatio));
  const licenseRule = firstRule(active, "license");
  if (licenseRule) {
    for (const scene of timeline.scenes) {
      const risky = scene.visuals
        .map((visual) => visual.licenseKind)
        .filter((kind): kind is LicenseKind => kind !== null && RISKY_LICENSES.includes(kind));
      if (!risky.length) continue;
      findings.push({
        ruleId: licenseRule.key,
        severity: licenseRule.severity,
        sceneId: scene.sceneId,
        text: `Cảnh ${scene.order + 1} dùng hình có giấy phép cần kiểm tra: ${[...new Set(risky)].join(", ")}.`,
        quote: null,
        suggestion: "Đổi sang hình CC0/CC BY hoặc tự kiểm tra quyền sử dụng.",
      });
    }
    const musicLicense = timeline.music?.licenseKind ?? null;
    if (musicLicense && RISKY_LICENSES.includes(musicLicense)) {
      findings.push({
        ruleId: licenseRule.key,
        severity: licenseRule.severity,
        sceneId: null,
        text: `Nhạc nền có giấy phép cần kiểm tra: ${musicLicense}.`,
        quote: null,
        suggestion: "Chọn bản nhạc có giấy phép rõ ràng cho mục đích thương mại.",
      });
    }
  }
  return dedupe(findings);
}

function dedupe(findings: GuidelineFindingDraft[]): GuidelineFindingDraft[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.ruleId}|${finding.sceneId ?? ""}|${finding.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
