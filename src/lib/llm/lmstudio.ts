import { formatModelHttpError, readOpenAIStream } from "./openai-stream";
import type { LmProbeResult } from "./lmstudio-url";

export type { LmProbeResult };
export type LmStatus = { state: "unknown" } | LmProbeResult;

export { normalizeBaseUrl } from "./lmstudio-url";

export async function probeLmStudio(baseUrl: string): Promise<LmProbeResult> {
  try {
    const res = await fetch(`/api/lm?baseUrl=${encodeURIComponent(baseUrl)}`, {
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json()) as {
      state?: string;
      models?: string[];
      url?: string;
      reason?: string;
      error?: string;
    };
    if (json.state === "online") {
      return { state: "online", models: json.models ?? [], url: json.url ?? baseUrl };
    }
    if (json.state === "offline") {
      return { state: "offline", reason: json.reason || json.error || "LM Studio probe failed.", url: json.url };
    }
    return {
      state: "offline",
      reason: json.error || "LM Studio probe failed.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("abort")) {
      return {
        state: "offline",
        reason: "LM Studio did not answer. Start the server in LM Studio.",
      };
    }
    return {
      state: "offline",
      reason: "Could not reach the Quarry server to talk to LM Studio.",
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
  const res = await fetch("/api/lm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: input.baseUrl,
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
    }),
    signal: input.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    let message = formatModelHttpError(res.status, body);
    try {
      const json = JSON.parse(body) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // keep HTTP fallback
    }
    throw new Error(message);
  }

  return readOpenAIStream(res, input.onDelta);
}
