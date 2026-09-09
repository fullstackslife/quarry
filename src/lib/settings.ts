export type ProviderId = "auto" | "lmstudio" | "grok";

export type Settings = {
  provider: ProviderId;
  lmStudioUrl: string;
  lmStudioModel: string;
  githubToken: string;
  temperature: number;
  maxFiles: number;
  maxChars: number;
};

export const DEFAULT_SETTINGS: Settings = {
  provider: "auto",
  lmStudioUrl: "http://100.66.236.13:1234/v1",
  lmStudioModel: "",
  githubToken: "",
  temperature: 0.2,
  maxFiles: 16,
  maxChars: 48000,
};

const KEY = "quarry.settings.v1";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      maxFiles: Math.min(Math.max(Number(parsed.maxFiles) || 16, 4), 24),
      maxChars: Math.min(Math.max(Number(parsed.maxChars) || 48000, 8000), 160000),
      temperature: Math.min(Math.max(Number(parsed.temperature) || 0.2, 0), 1.2),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(settings));
}
