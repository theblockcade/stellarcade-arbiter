// Applies migrations/001_init.sql against DATABASE_URL. Every statement in
// that file is CREATE TABLE/INDEX IF NOT EXISTS, so this is safe to run on
// every deploy, not just once — there's no separate migration-tracking
// table because there's only ever been this one file so far.
//
// Written as a plain Node script (not a shell command running psql)
// because the Docker image doesn't have a psql binary installed and adding
// one just for this is more image bloat than reusing the `pg` dependency
// the service already ships with.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set — refusing to run migrations against nothing.");
    process.exit(1);
  }

  const sql = readFileSync(join(__dirname, "..", "migrations", "001_init.sql"), "utf8");
  const client = new pg.Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    await client.query(sql);
    console.log("Migrations applied (001_init.sql).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
