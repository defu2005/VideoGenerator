import type { FastifyBaseLogger } from "fastify";
import type { PublishService } from "./publishService.js";
import type { AutomationService } from "../services/automationService.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { AnalyticsSyncService } from "../analytics/syncService.js";
import type { FinanceService } from "../finance/financeService.js";

const INTERVAL_MS = 60_000;

/**
 * In-process ticker: promote due SCHEDULED publications, run daily connection checks,
 * and drive profile automation (topic → AUTO project → publish).
 * Survives restarts because SCHEDULED / topic state lives in the DB.
 */
export class PublishTicker {
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private running = false;
  private readonly controller = new AbortController();
  private lastDailyCheckDay = "";
  private automation: AutomationService | undefined;
  private notifications: NotificationService | undefined;
  private analytics: AnalyticsSyncService | undefined;
  private analyticsRunning = false;
  private finance: FinanceService | undefined;
  private financeRunning = false;

  constructor(
    private readonly publish: PublishService,
    private readonly logger: FastifyBaseLogger,
    private readonly intervalMs = INTERVAL_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Wire automation after construction (avoids circular init in buildApp). */
  setAutomation(automation: AutomationService): void {
    this.automation = automation;
  }

  setNotifications(service: NotificationService): void {
    this.notifications = service;
  }

  setAnalytics(service: AnalyticsSyncService): void {
    this.analytics = service;
  }

  setFinance(service: FinanceService): void {
    this.finance = service;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Exposed for tests. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const promoted = this.publish.promoteDueScheduled();
      if (promoted > 0) {
        this.logger.info({ promoted }, "Promoted due scheduled publications");
      }
      const day = this.now().toISOString().slice(0, 10);
      if (day !== this.lastDailyCheckDay) {
        this.lastDailyCheckDay = day;
        const checked = await this.publish.runDailyConnectionChecks(this.controller.signal);
        if (checked > 0) {
          this.logger.info({ checked }, "Daily connection checks completed");
        }
      }
      if (this.automation) {
        await this.automation.tick();
      }
      if (this.notifications) {
        await this.notifications.tick();
      }
      // Analytics runs on its own so a slow platform API never delays publishing.
      if (this.analytics && !this.analyticsRunning) {
        this.analyticsRunning = true;
        void this.analytics.tick(this.controller.signal)
          .catch((error) => this.logger.warn({ err: error }, "Analytics tick failed"))
          .finally(() => { this.analyticsRunning = false; });
      }
      if (this.finance && !this.financeRunning) {
        this.financeRunning = true;
        void this.finance.tick(this.controller.signal)
          .catch((error) => this.logger.warn({ err: error }, "Finance tick failed"))
          .finally(() => { this.financeRunning = false; });
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Publish ticker tick failed");
    } finally {
      this.running = false;
    }
  }

  private schedule(delay: number): void {
    if (!this.started) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => this.schedule(this.intervalMs));
    }, delay);
  }
}
