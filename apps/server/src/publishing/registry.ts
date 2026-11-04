import type { PlatformId } from "@vg/shared";
import { MockPublisher } from "./mockPublisher.js";
import type { Publisher } from "./types.js";

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

export function createPublisherRegistry(options: { enableMock: boolean }): {
  registry: PublisherRegistry;
  mock: MockPublisher | null;
} {
  const registry = new PublisherRegistry();
  let mock: MockPublisher | null = null;
  if (options.enableMock) {
    mock = new MockPublisher();
    registry.register(mock);
  }
  return { registry, mock };
}
