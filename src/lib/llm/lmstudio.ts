import { formatModelHttpError, readOpenAIStream } from "./openai-stream";

export type LmProbeResult =
  | { state: "online"; models: string[] }
  | { state: "offline"; reason: string };

export type LmStatus = { state: "unknown" } | LmProbeResult;

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function probeLmStudio(baseUrl: string): Promise<LmProbeResult> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    return { state: "offline", reason: "Set an LM Studio server URL in Settings." };
  }
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: "Bearer lm-studio" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return {
        state: "offline",
        reason: `LM Studio responded ${res.status}. Start the local server and enable CORS.`,
      };
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));
    return { state: "online", models };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("abort")) {
      return {
        state: "offline",
        reason: "LM Studio did not answer. Start the server and enable CORS.",
      };
    }
    return {
      state: "offline",
      reason:
        "Could not reach LM Studio from this browser. Start the local server, enable CORS, and if you are on a phone use your computer's network address.",
    };
  }
}

export async function completeWithLmStudio(input: {
  baseUrl: string;
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const base = normalizeBaseUrl(input.baseUrl);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer lm-studio",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: 4096,
      stream: true,
    }),
    signal: input.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(formatModelHttpError(res.status, body));
  }

  return readOpenAIStream(res, input.onDelta);
}
