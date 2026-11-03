import type { AppConfig } from "../../lib/config.js";
import { MockImageProvider } from "./mock.js";
import { OpenverseImageProvider } from "./openverse.js";
import { PexelsImageProvider } from "./pexels.js";
import { WikimediaImageProvider } from "./wikimedia.js";
import type { ImageSearchProvider } from "./types.js";

export class ImageProviderRegistry {
  readonly providers: ImageSearchProvider[];
  constructor(private readonly config: AppConfig, providers?: ImageSearchProvider[]) {
    const available = providers ?? [
      new WikimediaImageProvider(config),
      new OpenverseImageProvider(config),
      new PexelsImageProvider(config),
      new MockImageProvider(),
    ];
    this.providers = config.IMAGE_PROVIDERS.split(",").map((id) => id.trim())
      .filter(Boolean)
      .map((id) => {
        const provider = available.find((item) => item.id === id);
        if (!provider) throw new Error(`Unknown image provider "${id}" in IMAGE_PROVIDERS`);
        return provider;
      })
      .filter((provider) => provider.enabled(config));
  }

  get(id: string): ImageSearchProvider | undefined {
    return this.providers.find((provider) => provider.id === id);
  }

  list(): ImageSearchProvider[] {
    return this.providers;
  }
}
