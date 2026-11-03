export class TokenBucketRateLimiter {
  private readonly nextAvailable = new Map<string, number>();

  constructor(
    private readonly requestsPerMinute: Readonly<Record<string, number>> = {
      wikimedia: 60,
      openverse: 20,
      pexels: 180,
    },
    private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void> = delay,
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

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Request aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
