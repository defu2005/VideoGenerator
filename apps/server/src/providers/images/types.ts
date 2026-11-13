import type { LicenseMetadata, VisualProvider } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";

export type ImageOrientation = "landscape" | "portrait" | "square";

export type NormalizedImageResult = {
  provider: VisualProvider;
  providerItemId: string;
  sourceProvider?: string;
  title: string;
  description: string;
  tags: string[];
  previewUrl: string;
  imageUrl: string;
  sourceUrl: string;
  sourcePageUrl?: string;
  sourceSite: string;
  width: number;
  height: number;
  fileType: string;
  watermark: "NONE" | "SUSPECTED" | "UNKNOWN";
  license: LicenseMetadata;
  /** False for web finds without a reliable CC/PD/Commons signal; stock providers omit (treated as verified). */
  licenseVerified?: boolean;
  why?: string;
  providerPosition?: number;
  searchQuery?: string;
  /** Unsplash download_location — pinged once when the image is selected. */
  downloadLocation?: string;
  /** Present when reusing a stored candidate that previously failed to download. */
  downloadError?: string | null;
  phash?: string;
  phashCenter?: string;
};

export type ImageSearchInput = {
  query: string;
  perPage: number;
  orientation: ImageOrientation;
  signal?: AbortSignal;
};

export interface ImageSearchProvider {
  id: VisualProvider;
  enabled(config: AppConfig): boolean;
  search(input: ImageSearchInput): Promise<NormalizedImageResult[]>;
}

export type FetchJson = (input: string | URL, init?: RequestInit) => Promise<Response>;
