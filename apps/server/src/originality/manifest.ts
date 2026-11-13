import { contributionSummary, normalizedWords, SourceManifestSchema, type ComposePlan, type Script, type SourceAsset, type SourceManifest, type Timeline } from "@vg/shared";

export type ManifestCandidate = {
  id: string; origin: string; provider: string; source_url: string | null; source_page_url: string | null;
  license: string; license_verified: number; phash: string | null;
};
export type ManifestScene = { id: string; section_id: string | null; narration: string };
export type ManifestVoice = { id: string; scene_id: string; provider: string; voice: string };
export type ManifestInput = {
  script: Script | null; research: { keyFacts?: Array<{ sourceHint?: string | null }> } | null;
  timeline: Timeline | null; candidates: ManifestCandidate[]; scenes: ManifestScene[]; voices: ManifestVoice[];
  timelineHash: string; history?: SourceManifest["history"]; renderedAssets?: SourceAsset[] | null;
  renderTimelineHash?: string | null;
  composePlan?: ComposePlan | null;
};

/** Evidence links are public URLs only: credentials, query and fragments never leave this boundary. */
export function publicSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.search = ""; url.hash = "";
    return url.toString();
  } catch { return null; }
}
function licenseOf(candidate: ManifestCandidate | undefined): SourceAsset["license"] {
  if (!candidate) return null;
  try {
    const license = JSON.parse(candidate.license) as { kind?: string; name?: string; url?: string };
    return typeof license.kind === "string" ? { kind: license.kind, name: license.name ?? license.kind, url: publicSourceUrl(license.url) } : null;
  } catch { return null; }
}
export function buildSourceManifest(input: ManifestInput): SourceManifest {
  const { timeline, script } = input;
  const candidates = new Map(input.candidates.map((c) => [c.id, c]));
  const analysisSectionIds = script?.sections.filter((section) =>
    /phân tích|giải thích|so sánh|nguyên nhân|vì sao|tại sao|hệ quả|analysis|explain|compar|why|cause|consequence/iu.test(`${section.heading} ${section.sectionKey ?? ""}`)
      && normalizedWords(section.narration).length > 0).map((s) => s.id) ?? [];
  const sources = new Map<string, { url: string; title: string }>();
  for (const fact of input.research?.keyFacts ?? []) {
    const hint = fact.sourceHint ?? "";
    for (const match of hint.matchAll(/https?:\/\/[^\s<>"\])]+/gu)) {
      const url = publicSourceUrl(match[0].replace(/[.,;]+$/, ""));
      if (url) sources.set(url, { url, title: hint.replace(/https?:\/\/\S+/gu, "").trim().slice(0, 300) || new URL(url).hostname });
    }
  }
  const asset = (sceneId: string, id: string | null, startSec: number, endSec: number): SourceAsset => {
    const c = id ? candidates.get(id) : undefined;
    const kind: SourceAsset["kind"] = c?.origin === "AI_GENERATED" ? "ai_generated"
      : c?.origin === "UPLOAD" ? "user_upload"
      : !c || c.origin === "CUSTOM_URL" || ["brave", "web-grounding", "custom"].includes(c.provider) ? "web" : "stock";
    return { sceneId, assetId: id ?? `missing:${sceneId}`, kind,
      sourceUrl: publicSourceUrl(c?.source_page_url ?? c?.source_url), license: licenseOf(c),
      licenseVerified: Boolean(c?.license_verified), startSec, screenSeconds: Math.max(0, endSec - startSec), pHash: c?.phash ?? null };
  };
  const assets: SourceAsset[] = [];
  for (const scene of timeline?.scenes ?? []) {
    const plan = input.composePlan?.scenes.find((p) => p.sceneId === scene.sceneId);
    if (plan) {
      for (const shot of plan.shots) {
        const startSec = scene.startSec + shot.startSec;
        const endSec = Math.min(scene.endSec, scene.startSec + shot.endSec);
        if (shot.source.kind === "still") assets.push(asset(scene.sceneId, shot.source.candidateId, startSec, endSec));
        else if (shot.source.kind === "footage") assets.push({ sceneId: scene.sceneId, assetId: `footage:${shot.source.license.provider}:${shot.source.clipId}`,
          kind: "third_party_footage", sourceUrl: publicSourceUrl(shot.source.license.pageUrl),
          license: { kind: "ROYALTY_FREE", name: shot.source.license.licenseName, url: publicSourceUrl(shot.source.license.pageUrl) },
          licenseVerified: true, startSec, screenSeconds: Math.max(0, endSec - startSec), pHash: null });
        else assets.push({ sceneId: scene.sceneId, assetId: shot.id, kind: "own_template", sourceUrl: null,
          license: null, licenseVerified: true, startSec, screenSeconds: Math.max(0, endSec - startSec), pHash: null });
      }
    } else for (const visual of scene.visuals) assets.push(asset(scene.sceneId, visual.candidateId, visual.startSec, visual.endSec));
  }
  // A small overlay is not evidence that the whole underlying third-party scene is ours.
  for (const graphic of timeline?.graphics ?? []) if (graphic.layer === "fullscreen") assets.push({
    sceneId: graphic.sceneId ?? "video", assetId: graphic.id, kind: "own_template", sourceUrl: null,
    license: null, licenseVerified: true, startSec: graphic.startSec, screenSeconds: graphic.durationSec, pHash: null,
  });
  const finalAssets = input.renderedAssets ?? assets;
  const voice = input.voices.filter((v) => timeline?.scenes.some((s) => s.sceneId === v.scene_id && s.voice?.trackId === v.id))
    .map((v) => ({ sceneId: v.scene_id, provider: v.provider, voice: v.voice }));
  const analysis = (timeline?.scenes ?? []).flatMap((scene) => {
    const stored = input.scenes.find((s) => s.id === scene.sceneId);
    return scene.voice && voice.some((v) => v.sceneId === scene.sceneId) && stored?.section_id && analysisSectionIds.includes(stored.section_id)
      && normalizedWords(stored.narration).length
      ? [{ startSec: scene.voice.startSec, screenSeconds: scene.voice.durationSec }] : [];
  });
  // Count recorded scene narration when available; script text alone is not a voice track.
  const narration = input.scenes.length ? input.scenes.map((s) => s.narration).join(" ") : script?.sections.map((s) => s.narration).join(" ") ?? "";
  return SourceManifestSchema.parse({
    script: { sources: [...sources.values()], narrationWordCount: normalizedWords(narration).length,
      hasAnalysis: analysisSectionIds.length > 0, analysisSectionIds },
    assets: finalAssets, voice, contribution: contributionSummary(finalAssets, analysis, timeline?.totalDurationSec ?? 0),
    history: input.history ?? [], timelineHash: input.timelineHash,
    renderTimelineHash: input.renderTimelineHash ?? null,
    renderedAssets: input.composePlan ? finalAssets : input.renderedAssets ?? null,
  });
}
