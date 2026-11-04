import { sleepWithAbort } from "./retry.js";

export class TokenBucketRateLimiter {
  private readonly nextAvailable = new Map<string, number>();

  constructor(
    private readonly requestsPerMinute: Readonly<Record<string, number>> = {
      wikimedia: 60,
      openverse: 20,
      pexels: 180,
    },
    private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void> = sleepWithAbort,
  ) {}

  async acquire(provider: string, signal?: AbortSignal): Promise<void> {
    const capacity = this.requestsPerMinute[provider] ?? 60;
    const interval = 60_000 / capacity;
    const current = this.now();
    const next = Math.max(current, this.nextAvailable.get(provider) ?? current);
    this.nextAvailable.set(provider, next + interval);
    const waitMs = next - current;
    if (waitMs > 0) await this.wait(waitMs, signal);
  }
}

export class HostDownloadRateLimiter {
  private readonly nextAvailable = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    private readonly minIntervalMs = 1_000,
    private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void> = sleepWithAbort,
  ) {}

  /** Block requests to this host for `milliseconds` from now (e.g. after HTTP 429). */
  cooldown(hostname: string, milliseconds: number): void {
    const until = this.now() + Math.min(Math.max(0, milliseconds), 60_000);
    this.cooldownUntil.set(hostname, Math.max(this.cooldownUntil.get(hostname) ?? 0, until));
  }

  async acquire(hostname: string, signal?: AbortSignal): Promise<void> {
    const current = this.now();
    const scheduled = Math.max(current, this.nextAvailable.get(hostname) ?? current, this.cooldownUntil.get(hostname) ?? current);
    this.nextAvailable.set(hostname, scheduled + this.minIntervalMs);
    if (scheduled > current) await this.wait(scheduled - current, signal);
  }
}
