import { hashesMatch } from "../visuals/phash.js";
import type { OriginalityScores, OriginalitySettings, SourceAsset, SourceManifest } from "./schema.js";

export function normalizedWords(text: string): string[] {
  return text.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}]+/gu) ?? [];
}
export function wordShingles(text: string, size = 5): Set<string> {
  const words = normalizedWords(text);
  if (!words.length) return new Set();
  // Short, non-empty scripts still compare; two empty scripts never count as evidence.
  if (words.length < size) return new Set([words.join(" ")]);
  return new Set(Array.from({ length: words.length - size + 1 }, (_, i) => words.slice(i, i + size).join(" ")));
}
export function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let same = 0;
  for (const value of left) if (right.has(value)) same++;
  return same / union.size;
}
export type EarlierOriginal = { projectId: string; title: string; script: string; assets: SourceAsset[] };
export function compareOriginality(script: string, title: string, assets: SourceAsset[], earlier: EarlierOriginal[]): OriginalityScores {
  const scriptWords = wordShingles(script);
  const titleWords = new Set(normalizedWords(title));
  let scriptMatch: OriginalityScores["script"] = null;
  let titleMatch: OriginalityScores["title"] = null;
  for (const old of earlier) {
    const similarity = jaccard(scriptWords, wordShingles(old.script));
    if (similarity > (scriptMatch?.similarity ?? 0)) scriptMatch = { projectId: old.projectId, title: old.title, similarity };
    const titleSimilarity = jaccard(titleWords, new Set(normalizedWords(old.title)));
    if (titleSimilarity > (titleMatch?.similarity ?? 0)) titleMatch = { projectId: old.projectId, title: old.title, similarity: titleSimilarity };
  }
  const valid = (hash: string | null): hash is string => hash !== null && /^[a-f\d]{16}$/i.test(hash);
  const seen = new Set<string>();
  const imageMatches: OriginalityScores["imageMatches"] = [];
  for (const asset of assets) {
    if (!valid(asset.pHash) || seen.has(asset.assetId)) continue;
    seen.add(asset.assetId);
    const old = earlier.find((project) => project.assets.some((image) => valid(image.pHash) && hashesMatch(asset.pHash!, image.pHash)));
    if (old) imageMatches.push({ assetId: asset.assetId, projectId: old.projectId, title: old.title });
  }
  return { script: scriptMatch, title: titleMatch, reusedImages: imageMatches.length, imageMatches, comparedProjects: earlier.length };
}

export type ScreenSpan = { startSec: number; screenSeconds: number };
/** Union, not sum: overlapping narration/graphics never double-count contribution. */
export function coveredSeconds(spans: ScreenSpan[], total: number): number {
  const sorted = spans.map((s) => [Math.max(0, s.startSec), Math.min(total, s.startSec + s.screenSeconds)] as const)
    .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let end = 0;
  let seconds = 0;
  for (const [start, next] of sorted) { seconds += Math.max(0, next - Math.max(start, end)); end = Math.max(end, next); }
  return seconds;
}
export function contributionSummary(assets: SourceAsset[], narratedAnalysis: ScreenSpan[], total: number): SourceManifest["contribution"] {
  const templates = assets.filter((a) => a.kind === "own_template");
  const share = (spans: ScreenSpan[]) => total > 0 ? Math.min(1, coveredSeconds(spans, total) / total) : 0;
  return {
    ownShare: share([...templates, ...narratedAnalysis]),
    narratedAnalysisShare: share(narratedAnalysis), templateShare: share(templates),
    thirdPartySourceCount: new Set(assets.filter((a) => ["web", "stock", "third_party_footage"].includes(a.kind)).flatMap((a) => a.sourceUrl ? [a.sourceUrl] : [])).size,
    aiGeneratedShare: share(assets.filter((a) => a.kind === "ai_generated")),
    unknownLicenseShare: share(assets.filter((a) => a.kind !== "own_template" && (!a.licenseVerified || !a.license || a.license.kind === "UNKNOWN"))),
  };
}
export type OriginalityIssue = { ruleId: string; text: string };
export function originalityIssues(manifest: SourceManifest, scores: OriginalityScores, settings: OriginalitySettings): OriginalityIssue[] {
  const issues: OriginalityIssue[] = [];
  if (scores.script && scores.script.similarity > settings.maxScriptSimilarity) issues.push({ ruleId: "ORIG_SCRIPT_SIMILAR", text: `Kịch bản giống “${scores.script.title}” (${scores.script.projectId}) ${(scores.script.similarity * 100).toFixed(1)}%, vượt ngưỡng nội bộ ${(settings.maxScriptSimilarity * 100).toFixed(1)}%.` });
  if (scores.reusedImages > settings.maxReusedImages) issues.push({ ruleId: "ORIG_IMAGES_REUSED", text: `${scores.reusedImages} ảnh trùng video trước (ngưỡng nội bộ ${settings.maxReusedImages}): ${[...new Set(scores.imageMatches.map((m) => `${m.title} (${m.projectId})`))].join(", ")}.` });
  if (manifest.contribution.ownShare < settings.minOwnContributionShare) issues.push({ ruleId: "ORIG_LOW_CONTRIBUTION", text: `Đóng góp riêng có bằng chứng ${(manifest.contribution.ownShare * 100).toFixed(1)}%, dưới ngưỡng nội bộ ${(settings.minOwnContributionShare * 100).toFixed(1)}%.` });
  const missing: string[] = [];
  if (settings.requireNarration && (!manifest.script.narrationWordCount || !manifest.voice.length)) missing.push("chưa có lời dẫn và giọng đọc đã lưu");
  if (!manifest.script.sources.length) missing.push("chưa có URL nguồn nghiên cứu");
  if (manifest.contribution.unknownLicenseShare > 0.5) missing.push(`${(manifest.contribution.unknownLicenseShare * 100).toFixed(1)}% thời gian có asset chưa rõ giấy phép`);
  if (missing.length) issues.push({ ruleId: "ORIG_NO_EVIDENCE", text: `Cần bạn kiểm tra bằng chứng: ${missing.join("; ")}.` });
  return issues;
}

/** Reminders from RESEARCH-072; not automated platform eligibility decisions. */
export const ORIGINALITY_CHECKLIST = [
  { platform: "YouTube", text: "Có phân tích/cách kể riêng; kiểm nội dung lặp lại toàn kênh. Giấy phép và nhãn AI không tự chứng minh tính nguyên bản.", url: "https://support.google.com/youtube/answer/1311392" },
  { platform: "TikTok", text: "Duyệt từng clip: tránh sao chép, watermark người khác, chỉnh nhẹ, vòng lặp hoặc chuỗi ảnh/chữ đơn thuần; kiểm Creator Rewards riêng.", url: "https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program" },
  { platform: "Facebook", text: "Chỉ rõ phân tích hoặc cải biên thực chất khi dùng footage bên thứ ba; chữ, viền hay đổi tốc độ chỉ là chỉnh nhẹ.", url: "https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/amp/" },
  { platform: "Instagram", text: "Kiểm nội dung đăng lại, định dạng tĩnh, looping và montage chữ; điều kiện kiếm tiền và được đề xuất là hai phép kiểm riêng.", url: "https://help.instagram.com/2635536099905516" },
] as const;
