import type { FastifyBaseLogger } from "fastify";
import type { PublishService } from "./publishService.js";
import type { AutomationService } from "../services/automationService.js";

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
