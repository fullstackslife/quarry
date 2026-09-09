#!/usr/bin/env node
/**
 * Push a Quarry operator dump (reviews / watchlist / playbooks) into DATABASE_URL.
 * Does not read GitHub tokens or LM_API_TOKEN.
 *
 *   railway run --service quarry -- npm run db:push -- quarry-dump.json
 *   DATABASE_URL=... npm run db:push -- quarry-dump.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

function rewriteRailwayPublicUrl(url) {
  if (!url) return url;
  const proxyHost = process.env.RAILWAY_TCP_PROXY_DOMAIN?.trim();
  const proxyPort = process.env.RAILWAY_TCP_PROXY_PORT?.trim();
  if (!proxyHost || !proxyPort || !/railway\.internal/i.test(url)) return url;
  const at = url.indexOf("@");
  if (at === -1) return url;
  const slash = url.indexOf("/", at);
  const path = slash === -1 ? "" : url.slice(slash);
  return `${url.slice(0, at + 1)}${proxyHost}:${proxyPort}${path}`;
}

const databaseUrl = rewriteRailwayPublicUrl(
  process.env.DATABASE_PUBLIC_URL?.trim() || process.env.DATABASE_URL?.trim(),
);
if (!databaseUrl) {
  console.error(
    "[push] Set DATABASE_URL. From this repo: railway run --service Postgres -- npm run db:push -- quarry-dump.json",
  );
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error("[push] Usage: npm run db:push -- <quarry-dump.json>");
  process.exit(1);
}

function asPlaybook(value) {
  const body = value && typeof value === "object" ? value : {};
  return {
    lens: body.lens ?? null,
    include: Array.isArray(body.include) ? body.include.map(String) : [],
    ignore: Array.isArray(body.ignore) ? body.ignore.map(String) : [],
  };
}

async function main() {
  const raw = await readFile(resolve(file), "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Dump must be a JSON object.");
  }
  const history = Array.isArray(parsed.history) ? parsed.history : null;
  if (!history) throw new Error("Dump needs a history array.");

  const watchlist = Array.isArray(parsed.watchlist)
    ? [...new Set(parsed.watchlist.map(String).filter(Boolean))]
    : [];
  const playbooks =
    parsed.playbooks && typeof parsed.playbooks === "object"
      ? parsed.playbooks
      : {};
  const defaultPlaybook = asPlaybook(parsed.defaultPlaybook);

  const local = /localhost|127\.0\.0\.1/i.test(databaseUrl);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let reviews = 0;
    for (const item of history) {
      if (!item || typeof item !== "object" || !item.id) continue;
      await client.query(
        `insert into quarry_reviews
          (id, saved_at, owner, repo, description, stars, language, lens, provider_label, result)
         values ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (id) do update set
           saved_at = excluded.saved_at,
           owner = excluded.owner,
           repo = excluded.repo,
           description = excluded.description,
           stars = excluded.stars,
           language = excluded.language,
           lens = excluded.lens,
           provider_label = excluded.provider_label,
           result = excluded.result`,
        [
          String(item.id),
          Number(item.savedAt) || Date.now(),
          String(item.owner ?? ""),
          String(item.repo ?? ""),
          item.description ?? null,
          Number(item.stars) || 0,
          item.language ?? null,
          String(item.lens ?? "full"),
          String(item.providerLabel ?? ""),
          JSON.stringify(item.result ?? {}),
        ],
      );
      reviews += 1;
    }

    for (const fullName of watchlist) {
      await client.query(
        `insert into quarry_watchlist (full_name) values ($1)
         on conflict (full_name) do nothing`,
        [fullName],
      );
    }

    const playbookRows = [
      ["__default__", defaultPlaybook],
      ...Object.entries(playbooks).map(([key, value]) => [key, asPlaybook(value)]),
    ];
    for (const [repoKey, playbook] of playbookRows) {
      await client.query(
        `insert into quarry_playbooks (repo_key, lens, include, ignore, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (repo_key) do update set
           lens = excluded.lens,
           include = excluded.include,
           ignore = excluded.ignore,
           updated_at = now()`,
        [repoKey, playbook.lens, playbook.include, playbook.ignore],
      );
    }
    await client.query("COMMIT");
    console.log(
      `[push] upserted ${reviews} review(s), ${watchlist.length} watchlist pin(s), ${playbookRows.length} playbook(s).`,
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // keep original
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[push] failed:", err?.message || err);
  process.exit(1);
});
