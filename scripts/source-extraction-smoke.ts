import "dotenv/config";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pool, transaction, one } from "../lib/db";
import { seedWorkspace } from "../lib/services/seed";
import { hashPassword } from "../lib/auth/passwords";
import { ingestSource } from "../lib/services/ingestion";
import { waitForExtraction } from "./lib/wait-for-extraction";
import { BusinessError } from "../lib/errors";
async function main() {
  const userId = randomUUID(),
    password = await hashPassword(randomBytes(32).toString("hex"));
  const setup = await transaction(async (db) => {
    await db.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
      [userId, `integration-test-${userId}@example.test`, password],
    );
    return seedWorkspace(db, userId, "PAYPAL_SANDBOX", true);
  });
  const sourceVersionId = await ingestSource(setup.workspaceId, "26090");
  const extractionId = await waitForExtraction(
    setup.workspaceId,
    sourceVersionId,
  );
  const extraction = await one<{
    status: string;
    provider: string;
    model: string;
    provider_response_id: string | null;
    validation_errors: unknown;
    candidate: {
      products: { model: { value: string | null }; serialScope: string }[];
      conflicts: unknown[];
    } | null;
  }>(
    pool,
    "SELECT status,provider,model,provider_response_id,validation_errors,candidate FROM extractions WHERE id=$1 AND workspace_id=$2",
    [extractionId, setup.workspaceId],
  );
  const report = {
    checkedAt: new Date().toISOString(),
    workspaceId: setup.workspaceId,
    sourceVersionId,
    extractionId,
    sourceOrigin: "CPSC_LIVE",
    provider: extraction!.provider,
    model: extraction!.model,
    responseId: extraction!.provider_response_id,
    status: extraction!.status,
    validationErrors: extraction!.validation_errors,
    products:
      extraction!.candidate?.products.map((p) => ({
        model: p.model.value,
        serialScope: p.serialScope,
      })) ?? [],
    conflictCount: extraction!.candidate?.conflicts.length ?? 0,
    humanReviewPerformed: false,
    paymentWrites: 0,
    keysDisplayed: false,
  };
  await mkdir("docs/reports", { recursive: true });
  await writeFile(
    "docs/reports/live-source-workflow.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (extraction!.status !== "CANDIDATE_READY") process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(
      e instanceof BusinessError ? e.code : "SOURCE_WORKFLOW_FAILED",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
