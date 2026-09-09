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

1. Start the server in LM Studio (Developer). Note the reachable URL, e.g. `http://100.66.236.13:1234`.
2. Set `LM_STUDIO_URL` to that host (with or without `/v1`) and `LM_API_TOKEN` from Manage Tokens.
3. Load a model (Ctrl+L). A coder model works best.
4. In Quarry → Settings, hit **Test connection**.
5. Select files (or **Select all**). Large sets are queued in small LM Studio jobs, then merged.

Until LM Studio connects, reviews use **Grok** if `XAI_API_KEY` is set.

### GitHub access

Public repos work without a token, but GitHub rate-limits that tightly. Private repos **require** a personal access token in Settings:

- Fine-grained: **Contents: Read** (and Metadata) on the repositories you review
- Classic: `repo` scope

The token stays in this browser. Without it, GitHub returns 404 for private repos.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript |

## How a review works

1. Open a repo by URL or `owner/repo` (private repos need a token).
2. Quarry fetches the tree and a smart file set (README, manifests, source).
3. Choose a lens: Full, Security, Architecture, Quality, Onboarding.
4. The selected files plus a tree excerpt go to the model.
5. Output is parsed into a structured report. History lives in `localStorage`.

No accounts. No server-side store of your token or reviews.
