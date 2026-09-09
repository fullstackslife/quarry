#!/usr/bin/env node
/**
 * Pull operator rows from Railway Postgres into a dump JSON file (no tokens).
 *
 *   railway run --service Postgres -- npm run db:pull -- quarry-dump.json
 */
import { writeFile } from "node:fs/promises";
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
    "[pull] Set DATABASE_URL. From this repo: railway run --service Postgres -- npm run db:pull -- quarry-dump.json",
  );
  process.exit(1);
}

const file = process.argv[2] ?? "quarry-dump.json";

async function main() {
  const local = /localhost|127\.0\.0\.1/i.test(databaseUrl);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const reviews = await client.query(
      `select id, (extract(epoch from saved_at) * 1000)::bigint as saved_at,
              owner, repo, description, stars, language, lens, provider_label, result
         from quarry_reviews
        order by saved_at desc`,
    );
    const pins = await client.query(
      `select full_name from quarry_watchlist order by full_name`,
    );
    const books = await client.query(
      `select repo_key, lens, include, ignore from quarry_playbooks`,
    );
    const playbooks = {};
    let defaultPlaybook = { lens: null, include: [], ignore: [] };
    for (const row of books.rows) {
      const playbook = {
        lens: row.lens,
        include: row.include ?? [],
        ignore: row.ignore ?? [],
      };
      if (row.repo_key === "__default__") defaultPlaybook = playbook;
      else playbooks[row.repo_key] = playbook;
    }
    const dump = {
      version: 1,
      exportedAt: Date.now(),
      history: reviews.rows.map((row) => ({
        id: row.id,
        savedAt: Number(row.saved_at),
        owner: row.owner,
        repo: row.repo,
        description: row.description,
        stars: row.stars,
        language: row.language,
        lens: row.lens,
        providerLabel: row.provider_label,
        result: row.result,
      })),
      watchlist: pins.rows.map((row) => row.full_name),
      playbooks,
      defaultPlaybook,
    };
    const out = resolve(file);
    await writeFile(out, `${JSON.stringify(dump, null, 2)}\n`);
    console.log(
      `[pull] wrote ${dump.history.length} review(s), ${dump.watchlist.length} pin(s), ${Object.keys(playbooks).length} playbook(s) to ${out}`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[pull] failed:", err?.message || err);
  process.exit(1);
});
