import "dotenv/config";
import { pool } from "../lib/db";
import { newSimulation } from "../lib/services/seed";
newSimulation()
  .then((result) =>
    console.log(
      "Created synthetic simulation workspace",
      result.workspaceId,
      "Open / to start a browser session.",
    ),
  )
  .catch(() => {
    console.error("Seed failed: check migrations and simulation capacity.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
