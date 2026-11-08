import pg from "pg";
export type DB = pg.Pool | pg.PoolClient;
const globalDb = globalThis as unknown as { rrPool?: pg.Pool };
export const pool =
  globalDb.rrPool ??
  new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://recallready:local_only_password@localhost:54329/recallready",
    max: 12,
    connectionTimeoutMillis: 5000,
  });
if (pool.listenerCount("error") === 0)
  pool.on("error", () =>
    console.error(
      JSON.stringify({
        code: "DATABASE_CONNECTION_LOST",
        message:
          "Idle database connection closed; subsequent work will reconnect.",
      }),
    ),
  );
if (process.env.NODE_ENV !== "production") globalDb.rrPool = pool;
export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function one<T = Record<string, unknown>>(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  return (await db.query(sql, args)).rows[0] as T | undefined;
}
