# Quarry

A local-first reviewer for **public GitHub repositories**. Paste `owner/repo`, pick a lens, and get a structured verdict — score, findings, strengths — from **your LM Studio model**. Grok is the hosted fallback when no local server is running.

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

Quarry talks to the model **from your browser**, so weights never leave the machine.

1. Load a model in LM Studio (a coder model works best).
2. Start the local server (default `http://127.0.0.1:1234/v1`).
3. Enable **CORS** in Developer settings.
4. In Quarry → Settings, confirm the server URL and hit **Test connection**.

On a phone, bind LM Studio to all interfaces and paste your computer’s LAN address.

Until LM Studio connects, reviews use **Grok** if `XAI_API_KEY` is set in the environment.

### GitHub rate limits

Unauthenticated GitHub access is tightly capped. A read-only personal access token in Settings (public repos is enough) stays in this browser and raises the limit.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript |

## How a review works

1. Open a public repo by URL or `owner/repo`.
2. Quarry fetches the tree and a smart file set (README, manifests, source).
3. Choose a lens: Full, Security, Architecture, Quality, Onboarding.
4. The selected files plus a tree excerpt go to the model.
5. Output is parsed into a structured report. History lives in `localStorage`.

No accounts. No server-side store of your token or reviews.
