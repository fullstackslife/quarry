export type RepoIdentity = {
  owner: string;
  repo: string;
};

export type RepoMeta = {
  owner: string;
  repo: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  homepage: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  topics: string[];
  private: boolean;
};

export type FileEntry = {
  path: string;
  size: number;
  sha: string;
};

export type RepoBundle = {
  meta: RepoMeta;
  languages: Record<string, number>;
  files: FileEntry[];
  selected: string[];
  contents: Record<string, string>;
  treeTruncated: boolean;
  listedTruncated: boolean;
  headSha: string;
  headRef: string;
};

export type GithubErrorCode =
  | "invalid"
  | "not_found"
  | "rate_limit"
  | "unauthorized"
  | "network";

export type GithubResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: GithubErrorCode };
