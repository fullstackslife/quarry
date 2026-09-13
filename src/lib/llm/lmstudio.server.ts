import { env } from "@/lib/env.server";
import { formatModelHttpError } from "./openai-stream";
import {
  isChatModelId,
  resolveLmStudioBaseUrl,
  toNativeLmStudioUrl,
} from "./lmstudio-url";

export function lmStudioAuthHeader(): string {
  return `Bearer ${env("LM_API_TOKEN") ?? "lm-studio"}`;
}

export function lmStudioBaseUrl(requested?: string): string {
  return resolveLmStudioBaseUrl(requested, env("LM_STUDIO_URL"));
}

async function fetchLoadedModelIds(openaiBase: string): Promise<string[]> {
  const native = toNativeLmStudioUrl(openaiBase);
  try {
    const res = await fetch(`${native}/api/v0/models`, {
      headers: { Authorization: lmStudioAuthHeader() },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { id?: string; state?: string }[];
    };
    return (json.data ?? [])
      .filter((item) => item.state === "loaded" && item.id)
      .map((item) => item.id as string);
  } catch {
    return [];
  }
}

export async function fetchLmStudioModels(
  requestedUrl?: string,
): Promise<import("./lmstudio-url").LmProbeResult> {
  const base = lmStudioBaseUrl(requestedUrl);
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: lmStudioAuthHeader() },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        state: "offline",
        url: base,
        reason:
          "LM Studio requires an API token. Set LM_API_TOKEN in .env to the token from Developer → Server Settings.",
      };
    }
    if (!res.ok) {
      return {
        state: "offline",
        url: base,
        reason: `LM Studio responded ${res.status}. Start the local server (default port 1234).`,
      };
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const downloaded = (json.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));

    const loaded = await fetchLoadedModelIds(base);
    const chatLoaded = loaded.filter(isChatModelId);
    const chatAll = downloaded.filter(isChatModelId);
    const models = [
      ...chatLoaded,
      ...chatAll.filter((id) => !chatLoaded.includes(id)),
    ];
    if (models.length === 0 && downloaded.length) {
      models.push(...downloaded);
    }

    return {
      state: "online",
      models,
      loaded: chatLoaded,
      url: base,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("abort")) {
      return {
        state: "offline",
        url: base,
        reason: "LM Studio did not answer. Start the server in LM Studio and load a model.",
      };
    }
    return {
      state: "offline",
      url: base,
      reason: `Could not reach LM Studio at ${base}.`,
    };
  }
}

async function ensureChatModelLoaded(openaiBase: string, model: string): Promise<string | null> {
  const loaded = await fetchLoadedModelIds(openaiBase);
  if (loaded.some((id) => id === model || id.endsWith(`/${model}`) || model.endsWith(`/${id}`))) {
    return null;
  }
  const native = toNativeLmStudioUrl(openaiBase);
  try {
    const res = await fetch(`${native}/api/v1/models/load`, {
      method: "POST",
      headers: {
        Authorization: lmStudioAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, context_length: 8192 }),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.ok) return null;
    const text = await res.text();
    return text.slice(0, 240) || `Could not load ${model} in LM Studio.`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("abort")) {
      return `Timed out loading ${model} in LM Studio.`;
    }
    return `Could not load ${model}: ${message || "unknown error"}`;
  }
}

export async function fetchLmStudioChat(input: {
  requestedUrl?: string;
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
}): Promise<Response> {
  const base = lmStudioBaseUrl(input.requestedUrl);
  const loadError = await ensureChatModelLoaded(base, input.model);
  if (loadError) {
    return Response.json({ error: loadError }, { status: 503 });
  }
  const upstream = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: lmStudioAuthHeader(),
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: 4096,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    const error =
      upstream.status === 401 || upstream.status === 403
        ? "LM Studio rejected the API token. Check LM_API_TOKEN."
        : formatModelHttpError(upstream.status, text);
    return Response.json({ error }, { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
