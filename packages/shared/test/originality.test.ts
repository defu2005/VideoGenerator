import { describe, expect, it } from "vitest";
import { compareOriginality, contributionSummary, DEFAULT_ORIGINALITY_SETTINGS, jaccard, originalityIssues, SourceManifestSchema, wordShingles, type SourceAsset } from "../src/index.js";

const asset = (patch: Partial<SourceAsset> = {}): SourceAsset => ({ sceneId: "scene", assetId: "image", kind: "stock",
  sourceUrl: "https://example.org/asset", license: { kind: "CC0", name: "CC0", url: null }, licenseVerified: true,
  startSec: 0, screenSeconds: 10, pHash: "0000000000000000", ...patch });
describe("originality comparisons", () => {
  it("uses normalized five-word shingles, including Vietnamese and punctuation", () => {
    expect(wordShingles("Một hai ba bốn năm sáu").size).toBe(2);
    expect(jaccard(wordShingles("Một, HAI ba bốn năm!"), wordShingles("một hai ba bốn năm"))).toBe(1);
    expect(jaccard(wordShingles(""), wordShingles(""))).toBe(0);
    expect(jaccard(wordShingles("hai từ"), wordShingles("hai từ"))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });
  it("keeps best script/title matches and counts each image once across shots and earlier videos", () => {
    const scores = compareOriginality("one two three four five six", "A new, video!", [asset(), asset(), asset({ assetId: "bad", pHash: "broken" })], [
      { projectId: "p1", title: "video new a", script: "one two three four five six", assets: [asset()] },
      { projectId: "p2", title: "other", script: "entirely different", assets: [asset()] },
    ]);
    expect(scores.script).toMatchObject({ projectId: "p1", similarity: 1 });
    expect(scores.title?.similarity).toBe(1);
    expect(scores.reusedImages).toBe(1);
    expect(scores.imageMatches).toHaveLength(1);
  });
  it("merges overlapping contribution, bounds screen time and separates AI/licence", () => {
    const summary = contributionSummary([asset({ kind: "own_template", startSec: 0, screenSeconds: 5 }),
      asset({ assetId: "ai", kind: "ai_generated", startSec: 5, licenseVerified: false })], [{ startSec: 3, screenSeconds: 5 }], 10);
    expect(summary.ownShare).toBe(.8);
    expect(summary.templateShare).toBe(.5);
    expect(summary.aiGeneratedShare).toBe(.5);
    expect(summary.unknownLicenseShare).toBe(.5);
    expect(contributionSummary([], [], 0).ownShare).toBe(0);
  });
  it("only fails thresholds beyond the boundary, and combines missing evidence into one finding", () => {
    const manifest = SourceManifestSchema.parse({ script: { sources: [{ url: "https://example.org", title: "source" }], narrationWordCount: 5, hasAnalysis: true, analysisSectionIds: ["analysis"] },
      assets: [], voice: [{ sceneId: "s", provider: "mock", voice: "fixture" }], contribution: { ownShare: .3, narratedAnalysisShare: .3, templateShare: 0, thirdPartySourceCount: 0, aiGeneratedShare: 0, unknownLicenseShare: .5 },
      history: [], timelineHash: "hash", renderTimelineHash: null, renderedAssets: null });
    const scores = { script: { projectId: "old", title: "Old", similarity: .5 }, title: null, reusedImages: 3, imageMatches: [], comparedProjects: 1 };
    expect(originalityIssues(manifest, scores, DEFAULT_ORIGINALITY_SETTINGS)).toEqual([]);
    manifest.contribution.ownShare = .29;
    manifest.contribution.unknownLicenseShare = .51;
    manifest.script.sources = []; manifest.voice = [];
    const rules = originalityIssues(manifest, { ...scores, reusedImages: 4, script: { ...scores.script, similarity: .51 } }, DEFAULT_ORIGINALITY_SETTINGS).map((x) => x.ruleId);
    expect(rules).toEqual(["ORIG_SCRIPT_SIMILAR", "ORIG_IMAGES_REUSED", "ORIG_LOW_CONTRIBUTION", "ORIG_NO_EVIDENCE"]);
    manifest.script.sources = [{ url: "https://example.org", title: "source" }]; manifest.contribution.unknownLicenseShare = 0;
    expect(originalityIssues(manifest, scores, { ...DEFAULT_ORIGINALITY_SETTINGS, requireNarration: false }).map((x) => x.ruleId)).not.toContain("ORIG_NO_EVIDENCE");
  });
});
