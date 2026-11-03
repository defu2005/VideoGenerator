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
  sourceSite: string;
  width: number;
  height: number;
  fileType: string;
  watermark: "NONE" | "SUSPECTED" | "UNKNOWN";
  license: LicenseMetadata;
  providerPosition?: number;
  searchQuery?: string;
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
