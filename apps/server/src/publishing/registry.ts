import type { PlatformId } from "@vg/shared";
import type { FacebookReelsPublisher } from "./facebookReelsPublisher.js";
import type { InstagramReelsPublisher } from "./instagramReelsPublisher.js";
import { MockPublisher } from "./mockPublisher.js";
import type { Publisher } from "./types.js";
import type { TikTokPublisher } from "./tiktokPublisher.js";
import type { YouTubePublisher } from "./youtubePublisher.js";

export class PublisherRegistry {
  private readonly publishers = new Map<PlatformId, Publisher>();

  register(publisher: Publisher): void {
    this.publishers.set(publisher.platform, publisher);
  }

  get(platform: PlatformId): Publisher | undefined {
    return this.publishers.get(platform);
  }

  require(platform: PlatformId): Publisher {
    const publisher = this.get(platform);
    if (!publisher) {
      throw new Error(`No publisher registered for platform ${platform}`);
    }
    return publisher;
  }

  has(platform: PlatformId): boolean {
    return this.publishers.has(platform);
  }

  list(): Publisher[] {
    return [...this.publishers.values()];
  }
}

export function createPublisherRegistry(options: {
  enableMock: boolean;
  youtube?: YouTubePublisher;
  tiktok?: TikTokPublisher;
  facebookReels?: FacebookReelsPublisher;
  instagramReels?: InstagramReelsPublisher;
}): {
  registry: PublisherRegistry;
  mock: MockPublisher | null;
} {
  const registry = new PublisherRegistry();
  let mock: MockPublisher | null = null;
  if (options.youtube) {
    registry.register(options.youtube);
  }
  if (options.tiktok) {
    registry.register(options.tiktok);
  }
  if (options.facebookReels) {
    registry.register(options.facebookReels);
  }
  if (options.instagramReels) {
    registry.register(options.instagramReels);
  }
  if (options.enableMock) {
    mock = new MockPublisher();
    registry.register(mock);
  }
  return { registry, mock };
}
