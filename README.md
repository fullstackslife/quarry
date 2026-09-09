# Quarry

A local-first reviewer for **GitHub repositories you can access**. Paste `owner/repo`, pick a lens, and get a structured verdict — score, findings, strengths — from **your LM Studio model**. Grok is the hosted fallback when no local server is running.

## Run it locally

Requires Node 22+.

```bash
git clone https://github.com/fullstackslife/quarry.git
cd quarry
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

### LM Studio

Quarry's server talks to LM Studio with `LM_API_TOKEN` (never sent to the browser). Copy `.env.example` to `.env`.

1. Start the server in LM Studio (Developer). Note the reachable URL, e.g. `http://127.0.0.1:1234` or a Tailscale address on `100.x.x.x`.
2. Set `LM_STUDIO_URL` to that host (with or without `/v1`) and `LM_API_TOKEN` from Manage Tokens.
3. Load a model (Ctrl+L). A coder model works best.
4. In Quarry → Settings, hit **Test connection**.
5. Select files (or **Select all**). Large sets are queued in small LM Studio jobs, then merged.

Until LM Studio connects, reviews use **Grok** if `XAI_API_KEY` is set.

### GitHub access

Public repos work without a token, but GitHub rate-limits that tightly. A personal access token in Settings lists **every repository that token can see**, including private ones, and is required to open them:

- Fine-grained: **Metadata: Read**, **Contents: Read and Write**, **Pull requests: Write** on the repositories you review
- Classic: `repo` scope

The token stays in this browser. Without it, GitHub returns 404 for private repos.

After a structured review, Quarry can ask the model for updated file text and push it to a `quarry/*` branch (update an existing quarry head, or nest `quarry/fix-…` from a PR/branch tip), then open or update a pull request. The default branch is never updated. GitHub check-runs are appended to the PR when the token can read them.

On Overview you can review the default branch, an open PR, another branch, or an issue. History can be exported as JSON or markdown.

### Watchlist rollout

Pin repositories from **Your repositories**, or **Find and pin** with GitHub code search (for example `warbot`) using the same token. Quarry runs that search through this app (not the browser) and scopes a bare query to your user and organizations. Set a **campaign playbook** (lens plus include/ignore globs). That playbook applies to every pinned repo unless the repo has its own playbook.

**Review pinned** walks the watchlist **one repository at a time** so a single LM Studio GPU is not swapping two trees. Inside a repo, file batches still run with the existing local concurrency. Stop pauses; Resume continues pending repos. Each finished review is written to History, and matching finding titles across repos show up as cross-repo patterns.

Code search needs a token that can search the repositories you care about (classic `repo` is enough).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply `migrations/` to `DATABASE_URL` |
| `npm run db:push` | Upsert a `quarry-dump.json` into Railway Postgres |

## How a review works

1. Open a repo from the token-backed list, by URL, or `owner/repo` (private repos need a token).
2. Pick a job (default HEAD, PR, branch, or issue). Quarry fetches that tree and a smart file set.
3. Choose a lens: Full, Security, Architecture, Quality, Onboarding.
4. The selected files plus a tree excerpt (and PR/issue digest) go to the model.
5. Output is parsed into a structured report. History lives in `localStorage` until you **Export dump** and `npm run db:push` it to Railway Postgres.
6. Or pin several repos and run the campaign playbook across them instead of opening each one by hand.

GitHub tokens and `LM_API_TOKEN` stay on this machine. The dump has reviews, watchlist, and playbooks only.

```bash
railway run --service Postgres -- npm run db:migrate
railway run --service Postgres -- npm run db:push -- quarry-dump.json
railway run --service Postgres -- npm run db:pull -- quarry-dump.json
```
