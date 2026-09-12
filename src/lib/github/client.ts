import {
  GITHUB_MAX_IN_FLIGHT,
  githubRetryDelayMs,
} from "./throttle";

export type GhResponse<T> = {
  status: number;
  json: T;
  remaining: string | null;
};

const MAX_ATTEMPTS = 8;

let active = 0;
const waiters: Array<() => void> = [];

async function acquireGithubSlot() {
  while (active >= GITHUB_MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }
  active += 1;
}

function releaseGithubSlot() {
  active = Math.max(0, active - 1);
  waiters.shift()?.();
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function githubRequest<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  token: string | undefined,
  body?: unknown,
  signal?: AbortSignal,
): Promise<GhResponse<T>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let last: GhResponse<T> | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let delay: number | null = null;
    await acquireGithubSlot();
    try {
      const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      const remaining = res.headers.get("x-ratelimit-remaining");
      let json: T = {} as T;
      const text = await res.text();
      if (text) {
        try {
          json = JSON.parse(text) as T;
        } catch {
          json = { message: text } as T;
        }
      }
      last = { status: res.status, json, remaining };
      const message =
        typeof (json as { message?: string }).message === "string"
          ? (json as { message: string }).message
          : text;
      delay = githubRetryDelayMs({
        status: res.status,
        remaining,
        message,
        retryAfter: res.headers.get("retry-after"),
        reset: res.headers.get("x-ratelimit-reset"),
        attempt,
      });
      if (delay == null || attempt === MAX_ATTEMPTS) return last;
    } finally {
      releaseGithubSlot();
    }
    if (delay == null) continue;
    await sleep(delay, signal);
  }
  return last ?? ({ status: 0, json: {} as T, remaining: null } satisfies GhResponse<T>);
}
