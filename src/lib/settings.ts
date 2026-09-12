import { DEFAULT_LM_STUDIO_URL } from "./llm/lmstudio-url";
import {
  clampLmStudioConcurrency,
  LM_STUDIO_DEFAULT_CONCURRENCY,
} from "./review/queue";

export type ProviderId = "auto" | "lmstudio" | "grok";

export type Settings = {
  provider: ProviderId;
  lmStudioUrl: string;
  lmStudioModel: string;
  githubToken: string;
  temperature: number;
  maxFiles: number;
  maxChars: number;
  /** In-flight LM Studio completions. Capped at 2. */
  lmStudioConcurrency: number;
};

export const DEFAULT_SETTINGS: Settings = {
  provider: "auto",
  lmStudioUrl: DEFAULT_LM_STUDIO_URL,
  lmStudioModel: "",
  githubToken: "",
  temperature: 0.2,
  maxFiles: 16,
  maxChars: 48000,
  lmStudioConcurrency: LM_STUDIO_DEFAULT_CONCURRENCY,
};

const KEY = "quarry.settings.v1";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const host =
      typeof window !== "undefined" ? window.location.hostname : "";
    const isPublicHost =
      host !== "" && host !== "localhost" && host !== "127.0.0.1";
    let lmStudioUrl = parsed.lmStudioUrl ?? DEFAULT_SETTINGS.lmStudioUrl;
    if (isPublicHost && /100\.66\.236\.13/.test(lmStudioUrl)) {
      lmStudioUrl = DEFAULT_LM_STUDIO_URL;
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      lmStudioUrl,
      maxFiles: Math.min(Math.max(Number(parsed.maxFiles) || 16, 4), 24),
      maxChars: Math.min(Math.max(Number(parsed.maxChars) || 48000, 8000), 160000),
      temperature: Math.min(Math.max(Number(parsed.temperature) || 0.2, 0), 1.2),
      lmStudioConcurrency: clampLmStudioConcurrency(parsed.lmStudioConcurrency),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(settings));
}
