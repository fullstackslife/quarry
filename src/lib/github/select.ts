import type { FileEntry } from "./types";
import type { ReviewLens } from "@/lib/review/types";

const SKIP_DIR =
  /(^|\/)(node_modules|dist|build|vendor|coverage|\.git|\.next|\.nuxt|\.output|out|target|__pycache__|\.venv|venv|\.turbo|storybook-static|Pods)(\/|$)/i;

const SKIP_FILE =
  /\.(png|jpe?g|gif|webp|ico|bmp|psd|woff2?|ttf|eot|otf|mp4|mp3|mov|wav|pdf|zip|gz|tgz|bz2|7z|rar|lock|min\.js|min\.css|map|bin|exe|dll|so|dylib|wasm|parquet|sqlite3?|pkl|pt|onnx|safetensors)$/i;

const SKIP_NAME =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|cargo\.lock|poetry\.lock|composer\.lock|go\.sum|uv\.lock)$/i;

export function isSkippedPath(path: string): boolean {
  return SKIP_DIR.test(path) || SKIP_FILE.test(path) || SKIP_NAME.test(path);
}

export function scoreFile(path: string, lens: ReviewLens): number {
  const base = path.split("/").pop() ?? path;
  const depth = path.split("/").length;
  let score = 12 - depth * 2;

  if (/^readme/i.test(base)) score += 120;
  if (/^security(\.md)?$/i.test(base)) score += 90;
  if (/^contributing/i.test(base)) score += 40;
  if (/^codeowners$/i.test(base)) score += 35;
  if (/^(license|copying)/i.test(base)) score += 20;

  if (
    /^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json|gemfile|makefile|dockerfile)$/i.test(
      base,
    )
  ) {
    score += 70;
  }
  if (
    /^(tsconfig.*\.json|vite\.config\.\w+|next\.config\.\w+|nuxt\.config\.\w+|astro\.config\.\w+|tailwind\.config\.\w+|eslint\.config\.\w+)$/i.test(
      base,
    )
  ) {
    score += 36;
  }

  if (/(^|\/)src\/(index|main|app|server|client)\.\w+$/i.test(path)) score += 55;
  if (/(^|\/)(app|src)\/(layout|page|routes)\.\w+$/i.test(path)) score += 42;
  if (/(^|\/)(cmd|pkg|internal|lib|src)\//i.test(path)) score += 10;

  if (lens === "security") {
    if (
      /auth|session|password|token|oauth|jwt|csrf|permis|secret|crypto|sql|inject|sanitize/i.test(
        path,
      )
    ) {
      score += 50;
    }
    if (/(^|\/)\.github\/workflows\//i.test(path)) score += 28;
    if (/dockerfile|compose\.ya?ml|helm|terraform|iam|rbac/i.test(path)) {
      score += 24;
    }
  }

  if (lens === "architecture") {
    if (/(^|\/)(src|app|pkg|internal|lib|server|client)\//i.test(path)) score += 18;
    if (/config|plugin|middleware|router|store|schema/i.test(path)) score += 16;
  }

  if (lens === "quality") {
    if (/\.(test|spec)\.\w+$/i.test(path) || /(^|\/)tests?\//i.test(path)) {
      score += 30;
    }
  }

  if (lens === "onboarding") {
    if (/^readme|contributing|docs\//i.test(path)) score += 40;
    if (/example|quickstart|getting-started/i.test(path)) score += 24;
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)$/i.test(path)) {
    score += 8;
  }

  return score;
}

export function listReviewableFiles(files: FileEntry[], cap = 400): FileEntry[] {
  const filtered = files
    .filter((file) => !isSkippedPath(file.path) && file.size > 0 && file.size < 400_000)
    .sort((a, b) => a.path.localeCompare(b.path));
  return filtered.slice(0, cap);
}

export function pickSmartFiles(
  files: FileEntry[],
  lens: ReviewLens,
  maxFiles: number,
  maxChars: number,
): string[] {
  const ranked = listReviewableFiles(files)
    .map((file) => ({ file, score: scoreFile(file.path, lens) }))
    .sort((a, b) => b.score - a.score || a.file.size - b.file.size);

  const selected: string[] = [];
  let used = 0;
  for (const item of ranked) {
    if (selected.length >= maxFiles) break;
    if (used + item.file.size > maxChars && selected.length >= 4) break;
    selected.push(item.file.path);
    used += item.file.size;
  }
  return selected;
}
