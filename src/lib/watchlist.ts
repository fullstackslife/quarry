const KEY = "quarry.watchlist.v1";

export function loadWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(String).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(pins: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify([...new Set(pins)]));
}

export function toggleWatchlist(pins: string[], fullName: string): string[] {
  const key = fullName.trim();
  const next = pins.includes(key)
    ? pins.filter((item) => item !== key)
    : [...pins, key];
  saveWatchlist(next);
  return next;
}

export function addWatchlistPins(pins: string[], names: string[]): string[] {
  const next = [
    ...new Set([
      ...pins,
      ...names.map((item) => item.trim()).filter(Boolean),
    ]),
  ];
  saveWatchlist(next);
  return next;
}
