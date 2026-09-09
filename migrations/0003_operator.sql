-- Operator corpus: reviews, watchlist, playbooks. No tokens or LM keys.
create table if not exists quarry_reviews (
  id text primary key,
  saved_at timestamptz not null,
  owner text not null,
  repo text not null,
  description text,
  stars integer not null default 0,
  language text,
  lens text not null,
  provider_label text not null,
  result jsonb not null
);

create index if not exists quarry_reviews_repo_idx
  on quarry_reviews (owner, repo, saved_at desc);

create table if not exists quarry_watchlist (
  full_name text primary key,
  pinned_at timestamptz not null default now()
);

create table if not exists quarry_playbooks (
  repo_key text primary key,
  lens text,
  include text[] not null default '{}',
  ignore text[] not null default '{}',
  updated_at timestamptz not null default now()
);
