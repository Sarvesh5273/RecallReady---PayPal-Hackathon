import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "../lib/db";
import { PayPalAdapter, sandboxConfigured } from "../lib/adapters/paypal";
import { extractionReadiness } from "../lib/adapters/extraction";
import { BusinessError } from "../lib/errors";
async function main() {
  const report: {
    checkedAt: string;
    paypal: {
      configured: boolean;
      authenticated: boolean;
      errorCode: string | null;
    };
    ai: ReturnType<typeof extractionReadiness>;
    database: { ready: boolean; sandboxOwnerExists: boolean };
    paymentWrites: number;
    keysDisplayed: boolean;
  } = {
    checkedAt: new Date().toISOString(),
    paypal: {
      configured: sandboxConfigured(),
      authenticated: false,
      errorCode: null,
    },
    ai: extractionReadiness(),
    database: { ready: false, sandboxOwnerExists: false },
    paymentWrites: 0,
    keysDisplayed: false,
  };
  try {
    await pool.query("SELECT 1");
    report.database.ready = true;
    const owners = await pool.query(
      "SELECT count(*)::int AS count FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE w.mode='PAYPAL_SANDBOX' AND m.role='OWNER' AND w.expires_at IS NULL",
    );
    report.database.sandboxOwnerExists = owners.rows[0].count > 0;
  } catch {
    report.database.ready = false;
  }
  if (report.paypal.configured) {
    try {
      const adapter = new PayPalAdapter("PAYPAL_SANDBOX");
      await adapter.prepare();
      report.paypal.authenticated = true;
    } catch (e) {
      report.paypal.errorCode =
        e instanceof BusinessError ? e.code : "PAYPAL_CONNECTION_FAILED";
    }
  }
  await mkdir("docs/reports", { recursive: true });
  await writeFile(
    "docs/reports/integration-preflight.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (
    !report.paypal.authenticated ||
    !report.database.ready ||
    !report.ai.configured
  )
    process.exitCode = 1;
}
main()
  .catch(() => {
    console.error(
      "PREFLIGHT_FAILED: Verification could not finish. No keys were displayed.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
