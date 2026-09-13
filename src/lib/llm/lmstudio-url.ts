export const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234/v1";

/** Same stack lm-studio-tools loads on the Tailscale box. Prefer these when they are in RAM. */
export const PREFERRED_REVIEW_MODELS = [
  "qwen2.5-coder-7b-instruct",
  "qwen/qwen3.5-9b",
  "google/gemma-4-e4b",
];

export type LmProbeResult =
  | { state: "online"; models: string[]; loaded: string[]; url: string }
  | { state: "offline"; reason: string; url?: string };

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** OpenAI-compat base (`…/v1`). Accepts the Developer page host (`:1234`) too. */
export function toOpenAiBaseUrl(url: string): string {
  let base = normalizeBaseUrl(url);
  if (base.endsWith("/api/v1")) {
    base = `${base.slice(0, -"/api/v1".length)}/v1`;
  } else if (!base.endsWith("/v1")) {
    base = `${base}/v1`;
  }
  return base;
}

/** Native LM Studio host (`:1234`) for `/api/v0/models` inventory. */
export function toNativeLmStudioUrl(url: string): string {
  const openai = toOpenAiBaseUrl(url);
  return openai.endsWith("/v1") ? openai.slice(0, -3).replace(/\/+$/, "") : openai;
}

export function isEmbeddingModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.includes("embed");
}

export function isChatModelId(id: string): boolean {
  const lower = id.trim().toLowerCase();
  if (!lower || isEmbeddingModelId(lower)) return false;
  return !/(^|\/|-)(asr|whisper|tts|vocoder|speech)($|\/|-)/i.test(lower);
}

/** Prefer a model that is actually loaded, matching lm-studio-tools coder/agent picks. */
export function pickReviewModel(
  loaded: string[],
  downloaded: string[],
  current?: string,
): string {
  const chatLoaded = loaded.filter(isChatModelId);
  const pool = chatLoaded.length ? chatLoaded : downloaded.filter(isChatModelId);
  const wanted = current?.trim() || "";
  if (wanted && pool.includes(wanted)) return wanted;
  for (const preferred of PREFERRED_REVIEW_MODELS) {
    if (pool.includes(preferred)) return preferred;
  }
  const coder = pool.find(
    (id) => /coder/i.test(id) && !/1\.5b/i.test(id),
  );
  if (coder) return coder;
  return pool[0] ?? wanted;
}

function ipv4ToInt(host: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: number, prefix: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (prefix & mask);
}

/** Loopback, RFC1918, Tailscale CGNAT (100.64/10), and MagicDNS. */
export function isAllowedLmStudioUrl(url: string): boolean {
  try {
    const parsed = new URL(normalizeBaseUrl(url));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "::1" || host.endsWith(".ts.net")) return true;
    const ip = ipv4ToInt(host);
    if (ip === null) return false;
    return (
      inCidr(ip, ipv4ToInt("127.0.0.0")!, 8) ||
      inCidr(ip, ipv4ToInt("10.0.0.0")!, 8) ||
      inCidr(ip, ipv4ToInt("172.16.0.0")!, 12) ||
      inCidr(ip, ipv4ToInt("192.168.0.0")!, 16) ||
      inCidr(ip, ipv4ToInt("100.64.0.0")!, 10)
    );
  } catch {
    return false;
  }
}

/** Env URL wins. Otherwise a private/Tailscale settings URL. Otherwise local default. */
export function resolveLmStudioBaseUrl(
  requested: string | undefined,
  envUrl: string | undefined,
): string {
  const fromEnv = envUrl ? toOpenAiBaseUrl(envUrl) : "";
  if (fromEnv) return fromEnv;
  if (requested && isAllowedLmStudioUrl(requested)) {
    return toOpenAiBaseUrl(requested);
  }
  return DEFAULT_LM_STUDIO_URL;
}
