import type { JobWorker } from "../jobs/worker.js";
import type { FacebookReelsPublisher } from "./facebookReelsPublisher.js";
import type { InstagramReelsPublisher } from "./instagramReelsPublisher.js";
import type { MockPublisher } from "./mockPublisher.js";
import type { OAuthStateStore } from "./oauthState.js";
import type { PublishService } from "./publishService.js";
import type { PublisherRegistry } from "./registry.js";
import type { PublishTicker } from "./ticker.js";
import type { TokenVault } from "./tokenVault.js";
import type { TikTokPublisher } from "./tiktokPublisher.js";
import type { YouTubePublisher } from "./youtubePublisher.js";
import type { AutomationService } from "../services/automationService.js";
import type { TopicService } from "../services/topicService.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { TelegramPoller } from "../notifications/telegram.js";
import type { AssistantService } from "../assistant/service.js";
import type { OperatorService } from "../operator/service.js";
import type { ClipService } from "../services/clipService.js";

declare module "fastify" {
  interface FastifyInstance {
    vgPublish: {
      mock: MockPublisher | null;
      youtube: YouTubePublisher;
      tiktok: TikTokPublisher;
      facebookReels: FacebookReelsPublisher;
      instagramReels: InstagramReelsPublisher;
      service: PublishService;
      vault: TokenVault;
      ticker: PublishTicker;
      oauthState: OAuthStateStore;
      worker: JobWorker;
      registry: PublisherRegistry;
    };
    vgAutomation: {
      service: AutomationService;
      topics: TopicService;
    };
    vgNotifications: {
      service: NotificationService;
      poller: TelegramPoller;
    };
    vgAssistant: {
      service: AssistantService;
    };
    vgOperator: {
      service: OperatorService;
    };
    vgClips: ClipService;
  }
}

export {};
