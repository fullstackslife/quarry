import { completeWithLmStudio } from "./lmstudio";
import { formatModelHttpError, readOpenAIStream } from "./openai-stream";

export async function completeWithGrok(input: {
  messages: { role: string; content: string }[];
  temperature: number;
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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

export async function completeChat(input: {
  target: "lmstudio" | "grok";
  lmStudioUrl: string;
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  if (input.target === "lmstudio") {
    return completeWithLmStudio({
      baseUrl: input.lmStudioUrl,
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      signal: input.signal,
      onDelta: input.onDelta,
    });
  }
  return completeWithGrok(input);
}
