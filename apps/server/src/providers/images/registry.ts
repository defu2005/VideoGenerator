import type { AppConfig } from "../../lib/config.js";
import { EuropeanaImageProvider } from "./europeana.js";
import { FlickrImageProvider } from "./flickr.js";
import { LocImageProvider } from "./loc.js";
import { MetImageProvider } from "./met.js";
import { MockImageProvider } from "./mock.js";
import { NasaImageProvider } from "./nasa.js";
import { OpenverseImageProvider } from "./openverse.js";
import { PexelsImageProvider } from "./pexels.js";
import { PixabayImageProvider } from "./pixabay.js";
import { SmithsonianImageProvider } from "./smithsonian.js";
import { UnsplashImageProvider } from "./unsplash.js";
import { WikimediaImageProvider } from "./wikimedia.js";
import type { ImageSearchProvider } from "./types.js";

const DEFAULT_PROVIDER_ORDER = [
  "wikimedia",
  "openverse",
  "pexels",
  "pixabay",
  "unsplash",
  "nasa",
  "met",
  "loc",
  "smithsonian",
  "europeana",
  "flickr",
];

export class ImageProviderRegistry {
  readonly providers: ImageSearchProvider[];
  private readonly available: ImageSearchProvider[];

  constructor(private readonly config: AppConfig, providers?: ImageSearchProvider[]) {
    this.available = providers ?? [
      new WikimediaImageProvider(config),
      new OpenverseImageProvider(config),
      new PexelsImageProvider(config),
      new PixabayImageProvider(config),
      new UnsplashImageProvider(config),
      new NasaImageProvider(config),
      new MetImageProvider(config),
      new LocImageProvider(config),
      new SmithsonianImageProvider(config),
      new EuropeanaImageProvider(config),
      new FlickrImageProvider(config),
      new MockImageProvider(),
    ];
    const configured = config.IMAGE_PROVIDERS.split(",").map((id) => id.trim()).filter(Boolean);
    const ids = configured.length > 0 ? configured : DEFAULT_PROVIDER_ORDER;
    this.providers = ids
      .map((id) => {
        const provider = this.available.find((item) => item.id === id);
        if (!provider) throw new Error(`Unknown image provider "${id}" in IMAGE_PROVIDERS`);
        return provider;
      })
      .filter((provider) => provider.enabled(config));
  }

  get(id: string): ImageSearchProvider | undefined {
    return this.providers.find((provider) => provider.id === id)
      ?? this.available.find((provider) => provider.id === id && provider.enabled(this.config));
  }

  list(): ImageSearchProvider[] {
    return this.providers;
  }

  /** All known providers (including disabled / missing-key), for settings status. */
  listAvailable(): ImageSearchProvider[] {
    return this.available.filter((provider) => provider.id !== "mock");
  }
}
