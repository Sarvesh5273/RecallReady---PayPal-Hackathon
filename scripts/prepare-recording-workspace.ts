import "dotenv/config";
import { access, mkdir, writeFile } from "node:fs/promises";
import { pool, one, transaction } from "../lib/db";
import { seedWorkspace } from "../lib/services/seed";
import { ingestSource } from "../lib/services/ingestion";
import { waitForExtraction } from "./lib/wait-for-extraction";
async function main() {
  const existingTake = await access("recordings/submission/take-state.json")
    .then(() => true)
    .catch(() => false);
  if (existingTake) throw new Error("EXISTING_RECORDING_WORKSPACE_PRESERVED");
  const ownerIndex = process.argv.indexOf("--owner-workspace");
  if (ownerIndex < 0 || !process.argv[ownerIndex + 1])
    throw new Error("OWNER_WORKSPACE_ARGUMENT_REQUIRED");
  const oldWorkspace = process.argv[ownerIndex + 1];
  const owner = await one<{ user_id: string }>(
    pool,
    "SELECT m.user_id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.role='OWNER' AND w.mode='PAYPAL_SANDBOX'",
    [oldWorkspace],
  );
  if (!owner) throw new Error("OWNER_REQUIRED");
  const take = await transaction((db) =>
    seedWorkspace(db, owner.user_id, "PAYPAL_SANDBOX", false),
  );
  const state = {
    workspaceId: take.workspaceId,
    sourceId: take.sourceId,
    sourceVersionId: null as string | null,
    extractionId: null as string | null,
    createdAt: new Date().toISOString(),
    purpose: "FRESH_SUBMISSION_RECORDING",
    sourceReady: false,
    paymentWrites: 0,
    keysDisplayed: false,
  };
  await mkdir("recordings/submission", { recursive: true });
  await writeFile(
    "recordings/submission/take-state.json",
    JSON.stringify(state, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      workspaceCreated: true,
      workspaceId: take.workspaceId,
      paymentWrites: 0,
      keysDisplayed: false,
    }),
  );
  state.sourceVersionId = await ingestSource(take.workspaceId, "26090");
  state.extractionId = await waitForExtraction(
    take.workspaceId,
    state.sourceVersionId,
  );
  const extraction = await one<{
    status: string;
    provider: string;
    model: string;
    validation_errors: unknown;
  }>(
    pool,
    "SELECT status,provider,model,validation_errors FROM extractions WHERE id=$1 AND workspace_id=$2",
    [state.extractionId, take.workspaceId],
  );
  state.sourceReady = extraction?.status === "CANDIDATE_READY";
  await writeFile(
    "recordings/submission/take-state.json",
    JSON.stringify(state, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      sourceReady: state.sourceReady,
      extraction,
      paymentWrites: 0,
      keysDisplayed: false,
    }),
  );
  if (!state.sourceReady) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error("RECORDING_WORKSPACE_PREPARATION_FAILED");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
