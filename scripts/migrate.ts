import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { pool } from "../lib/db";
export async function migrate() {
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(790612)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    for (const name of (await readdir("db/migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        (
          await db.query("SELECT name FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await db.query("BEGIN");
      try {
        await db.query(await readFile(`db/migrations/${name}`, "utf8"));
        await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          name,
        ]);
        await db.query("COMMIT");
        console.log("Applied", name);
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock(790612)");
    db.release();
  }
}
if (process.argv[1]?.endsWith("migrate.ts"))
  migrate()
    .then(() => pool.end())
    .catch(() => {
      console.error("Migration failed. Check database connectivity and SQL.");
      process.exitCode = 1;
      pool.end();
    });
