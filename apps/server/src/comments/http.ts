export class CommentHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CommentHttpError";
  }
}

export async function throwIfBad(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  const retryable = response.status === 429 || response.status >= 500;
  throw new CommentHttpError(`${label} (${response.status})`, response.status, retryable);
}

export function isNewerThan(publishedAt: string, since: string | null): boolean {
  if (!since) return true;
  const published = Date.parse(publishedAt);
  const cutoff = Date.parse(since);
  if (Number.isNaN(published) || Number.isNaN(cutoff)) return true;
  return published > cutoff;
}
