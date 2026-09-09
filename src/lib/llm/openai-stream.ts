export async function readOpenAIStream(
  res: Response,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.body || !contentType.includes("text/event-stream")) {
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string }; delta?: { content?: string } }[];
      error?: { message?: string } | string;
    };
    const text = payload.choices?.[0]?.message?.content ?? "";
    if (text) {
      onDelta(text);
      return text;
    }
    const err =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message;
    throw new Error(err || `Model error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string }; message?: { content?: string } }[];
        };
        const delta =
          json.choices?.[0]?.delta?.content ??
          json.choices?.[0]?.message?.content ??
          "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // ignore comments / keepalives
      }
    }
  }

  return full;
}

export function formatModelHttpError(status: number, body: string): string {
  if (status === 404) return "That model is not loaded. Pick another in Settings.";
  if (status === 413) return "The repo dump is too large for this model. Lower the file budget.";
  if (status === 429) return "The model is busy. Wait a moment and try again.";
  const snippet = body.replace(/\s+/g, " ").slice(0, 180);
  return snippet || `Model request failed (${status}).`;
}
