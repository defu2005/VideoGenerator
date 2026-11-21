import type Database from "better-sqlite3";
import type { Project, VisualCandidate } from "@vg/shared";
import { resolveBudget, visualFeaturesFor } from "@vg/shared";
import { visualQuality } from "../services/visualPolicy.js";
import type { NormalizedImageResult } from "../providers/images/types.js";

export function resolveFeatures(sqlite: Database.Database, project: Project): {
  altQueryAssist: boolean;
  semanticImageRerank: boolean;
  visualSearchBreadth: 8 | 16 | 32;
} {
  const features = visualFeaturesFor(resolveBudget(project), project.settings.visuals?.quality ?? visualQuality(sqlite, project.profileId));
  return {
    altQueryAssist: features.altQueryAssist,
    semanticImageRerank: features.semanticImageRerank,
    visualSearchBreadth: features.visualSearchBreadth,
  };
}

export function fromStoredCandidate(candidate: VisualCandidate): NormalizedImageResult {
  const providerPosition = candidate.scoreBreakdown.providerPosition;
  const downloadLocation = typeof candidate.scoreBreakdown.unsplashDownloadLocation === "string"
    ? candidate.scoreBreakdown.unsplashDownloadLocation
    : undefined;
  return {
    provider: candidate.provider,
    providerItemId: candidate.providerItemId,
    searchQuery: candidate.query,
    ...(typeof providerPosition === "number" ? { providerPosition } : {}),
    ...(candidate.sourceProvider ? { sourceProvider: candidate.sourceProvider } : {}),
    title: candidate.title,
    description: candidate.description,
    tags: candidate.tags,
    previewUrl: candidate.previewUrl,
    imageUrl: candidate.imageUrl,
    sourceUrl: candidate.sourceUrl,
    ...(candidate.sourcePageUrl ? { sourcePageUrl: candidate.sourcePageUrl } : {}),
    sourceSite: candidate.sourceSite,
    width: candidate.width,
    height: candidate.height,
    fileType: candidate.fileType,
    watermark: candidate.watermark,
    license: candidate.license,
    licenseVerified: candidate.licenseVerified,
    ...(candidate.why ? { why: candidate.why } : {}),
    ...(downloadLocation ? { downloadLocation } : {}),
    ...(candidate.downloadError ? { downloadError: candidate.downloadError } : {}),
    ...(candidate.phash ? { phash: candidate.phash } : {}),
    ...(candidate.phashCenter ? { phashCenter: candidate.phashCenter } : {}),
  };
}

export function toNormalizedCandidate(
  candidate: NormalizedImageResult & { relevanceScore: number; scoreBreakdown: VisualCandidate["scoreBreakdown"]; rank: number },
): NormalizedImageResult {
  return candidate;
}

export function downloadUrl(candidate: VisualCandidate): string {
  if (candidate.provider === "pexels") return candidate.imageUrl;
  if (candidate.fileType.toLowerCase() === "svg"
    || Math.max(candidate.width, candidate.height) > 2560) return candidate.previewUrl;
  return candidate.imageUrl;
}

export function makeLicense(input: {
  kind: VisualCandidate["license"]["kind"];
  name: string;
  author?: string;
  evidence: VisualCandidate["license"]["evidence"];
}): VisualCandidate["license"] {
  return {
    kind: input.kind,
    name: input.name,
    url: null,
    author: input.author ?? null,
    authorUrl: null,
    attributionRequired: input.kind === "USER_PROVIDED" && Boolean(input.author),
    attributionText: input.author ? `Image provided by ${input.author}` : "",
    evidence: input.evidence,
  };
}

export function candidateHost(candidate: VisualCandidate): string | null {
  try {
    return new URL(downloadUrl(candidate)).hostname;
  } catch {
    return null;
  }
}
