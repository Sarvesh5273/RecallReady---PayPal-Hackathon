import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { pool, one } from "../lib/db";
import { ingestSource } from "../lib/services/ingestion";
import { waitForExtraction } from "./lib/wait-for-extraction";
import { listCases, casePermission } from "../lib/services/cases";
import { matchProduct } from "../lib/domain/matching";
import { BusinessError } from "../lib/errors";
import type { Actor } from "../lib/auth/session";
async function main() {
  const owner = await one<{
    workspace_id: string;
    user_id: string;
    merchant_id: string;
    name: string;
  }>(
    pool,
    "SELECT w.id AS workspace_id,m.user_id,w.merchant_id,w.name FROM workspaces w JOIN memberships m ON m.workspace_id=w.id AND m.role='OWNER' WHERE w.mode='PAYPAL_SANDBOX' AND w.expires_at IS NULL ORDER BY w.created_at DESC LIMIT 1",
  );
  if (!owner)
    throw new BusinessError(
      "OWNER_MISSING",
      "Create a sandbox owner workspace first.",
      409,
    );
  const sourceVersionId = await ingestSource(owner.workspace_id, "26090");
  const extractionId = await waitForExtraction(
    owner.workspace_id,
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
    [extractionId, owner.workspace_id],
  );
  const actor: Actor = {
    workspaceId: owner.workspace_id,
    userId: owner.user_id,
    role: "OWNER",
    mode: "PAYPAL_SANDBOX",
    merchantId: owner.merchant_id,
    workspaceName: owner.name,
    sessionId: "service-check",
    csrfHash: "",
  };
  const cases = await listCases(actor);
  const sampleIds = ["RR-001", "RR-002", "RR-003", "RR-004", "RR-006"];
  const samples = cases
    .filter((c) => sampleIds.includes(c.display_id))
    .map((c) => ({
      order: c.display_id,
      matchState: matchProduct(
        {
          brand: c.brand,
          model: c.model,
          serial: c.serial,
          dateCode: c.date_code,
        },
        c.rule,
      ).state,
      financialEligibility: casePermission(c, "OWNER"),
      ownedPayment: !!c.owned,
      capturePresent: !!c.capture_id,
      ruleActive: c.rule_active,
      sourceIsLatest: c.latest_source_id === c.source_version_id,
    }));
  const report = {
    checkedAt: new Date().toISOString(),
    workspaceId: owner.workspace_id,
    sourceVersionId,
    extractionId,
    source: "CPSC_LIVE",
    ai: {
      status: extraction!.status,
      provider: extraction!.provider,
      model: extraction!.model,
      responseId: extraction!.provider_response_id,
      errors: extraction!.validation_errors,
      products: extraction!.candidate?.products.map((p) => ({
        model: p.model.value,
        serialScope: p.serialScope,
      })),
      conflicts: extraction!.candidate?.conflicts.length ?? 0,
    },
    caseCount: cases.length,
    samples,
    humanRuleApproved: false,
    paymentWrites: 0,
    keysDisplayed: false,
  };
  await mkdir("docs/reports", { recursive: true });
  await writeFile(
    "docs/reports/owner-workflow.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (extraction!.status !== "CANDIDATE_READY") process.exitCode = 1;
}
main()
  .catch((error) => {
    console.error(
      error instanceof BusinessError
        ? `${error.code}: ${error.message}`
        : "OWNER_WORKFLOW_CHECK_FAILED",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
