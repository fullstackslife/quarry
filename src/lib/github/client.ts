export type GhResponse<T> = {
  status: number;
  json: T;
  remaining: string | null;
};

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
  return { status: res.status, json, remaining };
}
