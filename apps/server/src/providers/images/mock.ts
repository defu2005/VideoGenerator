import type { AppConfig } from "../../lib/config.js";
import type { ImageSearchProvider, NormalizedImageResult } from "./types.js";

const mockLicenses = [
  { kind: "CC0", name: "CC0", attributionRequired: false },
  { kind: "CC_BY", name: "CC BY 4.0", attributionRequired: true },
  { kind: "UNKNOWN", name: "Unknown license", attributionRequired: false },
] as const;

export class MockImageProvider implements ImageSearchProvider {
  readonly id = "mock" as const;
  enabled(): boolean { return true; }

  async search(input: { query: string; perPage: number }): Promise<NormalizedImageResult[]> {
    return Array.from({ length: Math.min(input.perPage, 10) }, (_, index) => {
      const number = index === 1 ? 0 : index;
      const width = number === 2 ? 300 : number === 3 ? 1200 : 1920;
      const height = number === 2 ? 200 : number === 3 ? 1200 : 1080;
      const license = mockLicenses[number % mockLicenses.length];
      return {
        provider: this.id,
        providerItemId: `${input.query.toLowerCase().replace(/\W+/g, "-")}-${number}`,
        title: `${input.query} example ${number}`,
        description: `Deterministic mock result for ${input.query}`,
        tags: input.query.split(/\s+/),
        previewUrl: `https://images.example.test/${number}/preview.jpg`,
        imageUrl: `https://images.example.test/${number}/image.jpg`,
        sourceUrl: `https://images.example.test/${number}`,
        sourceSite: "Mock Images",
        width,
        height,
        fileType: number === 4 ? "svg" : "jpg",
        watermark: "NONE" as const,
        license: {
          ...license,
          url: null,
          author: "Example Photographer",
          authorUrl: null,
          attributionText: license.attributionRequired ? "By Example Photographer" : "",
          evidence: "api" as const,
        },
        providerPosition: Math.max(0, 1 - index / input.perPage),
      };
    });
  }
}
