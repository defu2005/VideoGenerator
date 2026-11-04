import type { JobWorker } from "../jobs/worker.js";
import type { MockPublisher } from "./mockPublisher.js";
import type { OAuthStateStore } from "./oauthState.js";
import type { PublishService } from "./publishService.js";
import type { PublisherRegistry } from "./registry.js";
import type { PublishTicker } from "./ticker.js";
import type { TokenVault } from "./tokenVault.js";

declare module "fastify" {
  interface FastifyInstance {
    vgPublish: {
      mock: MockPublisher | null;
      service: PublishService;
      vault: TokenVault;
      ticker: PublishTicker;
      oauthState: OAuthStateStore;
      worker: JobWorker;
      registry: PublisherRegistry;
    };
  }
}

export {};
