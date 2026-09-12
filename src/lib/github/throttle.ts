export const GITHUB_MAX_IN_FLIGHT = 2;

export function isGithubThrottle(status: number, remaining: string | null, message: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  if (remaining === "0") return true;
  return /abuse|secondary rate|rate limit/i.test(message);
}

export function githubRetryDelayMs(input: {
  status: number;
  remaining: string | null;
  message: string;
  retryAfter: string | null;
  reset: string | null;
  attempt: number;
  now?: number;
}): number | null {
  if (!isGithubThrottle(input.status, input.remaining, input.message)) return null;
  const retryAfter = Number(input.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(Math.ceil(retryAfter * 1000), 180_000);
  }
  const reset = Number(input.reset);
  const now = input.now ?? Date.now();
  if (Number.isFinite(reset) && reset > 0) {
    const untilReset = reset * 1000 - now;
    if (untilReset > 0) return Math.min(untilReset + 500, 180_000);
  }
  const backoff = Math.min(12_000 * 2 ** Math.max(0, input.attempt - 1), 90_000);
  return backoff;
}

export function isRetryableRolloutError(message: string | undefined): boolean {
  if (!message) return false;
  return /abuse detection|rate limit|wait a few minutes|GitHub refused|too many requests/i.test(
    message,
  );
}

export function isEmptyRepoError(message: string | undefined): boolean {
  return Boolean(message && /repository is empty/i.test(message));
}
