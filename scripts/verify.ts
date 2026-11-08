import "dotenv/config";
import { pool } from "../lib/db";
import { sandboxConfigured, guardPayPal } from "../lib/adapters/paypal";
import { extractionReadiness } from "../lib/adapters/extraction";
async function main() {
  const db = await pool.query(
    "SELECT name FROM schema_migrations ORDER BY name",
  );
  let sandboxGuard = true;
  try {
    guardPayPal("PAYPAL_SANDBOX");
  } catch {
    sandboxGuard = false;
  }
  console.log(
    JSON.stringify({
      migrations: db.rows.map((x) => x.name),
      paypalConfigured: sandboxConfigured(),
      sandboxGuard,
      ai: extractionReadiness(),
      operationsPerformed: ["DATABASE_READ"],
      providerWrites: 0,
    }),
  );
}
main()
  .catch(() => {
    console.error("Database or schema unavailable.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
