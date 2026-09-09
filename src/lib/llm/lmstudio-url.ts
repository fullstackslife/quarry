export const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234/v1";

export type LmProbeResult =
  | { state: "online"; models: string[]; url: string }
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
