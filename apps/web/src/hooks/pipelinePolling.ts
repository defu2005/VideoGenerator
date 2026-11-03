export function pipelinePollingDelay(attempt: number): number {
  return Math.min(3_000 * 2 ** attempt, 30_000);
}
