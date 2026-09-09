import type { RepoIdentity } from "./types";

export function parseRepoInput(input: string): RepoIdentity | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/\.git$/i, "");

  const fromUrl = normalized.match(
    /github\.com[:/]+([^/]+)\/([^/#?]+)/i,
  );
  if (fromUrl) {
    return {
      owner: fromUrl[1],
      repo: fromUrl[2].replace(/\.git$/i, ""),
    };
  }

  const simple = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (simple) {
    return { owner: simple[1], repo: simple[2] };
  }

  return null;
}
