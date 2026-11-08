import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pool, one } from "../lib/db";
import type { Actor } from "../lib/auth/session";
import type { Attempt } from "../lib/services/execution";
import { receipt } from "../lib/services/receipts";
import { z } from "zod";
async function main() {
  const index = process.argv.indexOf("--attempt");
  const attemptId = z
    .string()
    .uuid()
    .parse(index >= 0 ? process.argv[index + 1] : undefined);
  const outputIndex = process.argv.indexOf("--output-dir");
  const outputDir =
    outputIndex >= 0
      ? z
          .string()
          .min(1)
          .parse(process.argv[outputIndex + 1])
      : "docs/reports";
  const attempt = await one<Attempt>(
    pool,
    "SELECT * FROM payment_attempts WHERE id=$1 AND mode='PAYPAL_SANDBOX' AND status='COMPLETED'",
    [attemptId],
  );
  if (!attempt) throw new Error("COMPLETED_SANDBOX_ATTEMPT_REQUIRED");
  const owner = await one<{
    user_id: string;
    name: string;
    merchant_id: string;
  }>(
    pool,
    "SELECT m.user_id,w.name,w.merchant_id FROM workspaces w JOIN memberships m ON m.workspace_id=w.id AND m.role='OWNER' WHERE w.id=$1",
    [attempt.workspace_id],
  );
  const proof = await one<{
    evidence: Record<string, unknown>;
    recorded_at: Date;
    build_commit: string;
  }>(
    pool,
    "SELECT evidence,recorded_at,build_commit FROM demo_evidence_runs WHERE attempt_id=$1 AND workspace_id=$2 ORDER BY recorded_at DESC LIMIT 1",
    [attemptId, attempt.workspace_id],
  );
  if (!owner || !proof) throw new Error("OWNER_AND_PROVIDER_PROOF_REQUIRED");
  const actor: Actor = {
    workspaceId: attempt.workspace_id,
    userId: owner.user_id,
    role: "OWNER",
    mode: "PAYPAL_SANDBOX",
    merchantId: owner.merchant_id,
    workspaceName: owner.name,
    sessionId: "receipt-report",
    csrfHash: "",
  };
  const savedReceipt = await receipt(actor, attempt.case_id);
  const counts = await one<{
    attempts: number;
    execution_jobs: number;
    dispatch_events: number;
    repeat_events: number;
  }>(
    pool,
    "SELECT (SELECT count(*)::int FROM payment_attempts WHERE workspace_id=$1 AND capture_id=$2) AS attempts,(SELECT count(*)::int FROM jobs WHERE workspace_id=$1 AND kind='EXECUTE_REFUND' AND payload->>'attemptId'=$3) AS execution_jobs,(SELECT count(*)::int FROM audit_events WHERE workspace_id=$1 AND entity_id=$3::uuid AND event_type='ATTEMPT_DISPATCHING') AS dispatch_events,(SELECT count(*)::int FROM audit_events WHERE workspace_id=$1 AND entity_id=$3::uuid AND event_type='EXISTING_ATTEMPT_RETURNED') AS repeat_events",
    [attempt.workspace_id, attempt.capture_id, attemptId],
  );
  const source = await one(
    pool,
    "SELECT s.origin,s.freshness_checked_at,e.provider,e.model,e.provider_response_id,e.prompt_version,e.status AS extraction_status,e.validation_errors,r.revision AS reviewed_rule_revision,r.reviewed_at FROM cases c JOIN source_versions s ON s.id=c.source_version_id JOIN reviewed_rules r ON r.id=c.rule_id JOIN extractions e ON e.id=r.extraction_id WHERE c.id=$1 AND c.workspace_id=$2",
    [attempt.case_id, attempt.workspace_id],
  );
  if (
    counts?.attempts !== 1 ||
    counts.execution_jobs !== 1 ||
    counts.dispatch_events !== 1 ||
    counts.repeat_events < 1
  )
    throw new Error("DUPLICATE_CHECK_INCOMPLETE");
  const report = {
    checkedAt: new Date().toISOString(),
    mode: "PAYPAL_SANDBOX",
    workspaceId: attempt.workspace_id,
    source,
    recordedProof: proof.evidence,
    recordedAt: proof.recorded_at,
    buildReference: proof.build_commit,
    duplicateCheck: counts,
    providerWritesDuringVerification: 0,
    keysDisplayed: false,
    limitations: [
      "Synthetic merchant, people, and order evidence.",
      ...(proof.evidence.verificationMethod === "ORDER_AND_REFUND_GET_RECOVERY"
        ? [
            "Refund recovered from authoritative order and refund GET records after response-link parsing failed.",
            "Recovery verifies the capture was refunded; provider-write actor attribution is not independently established.",
          ]
        : []),
      "Provider evidence does not establish production readiness or merchant demand.",
    ],
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "sandbox-workflow-completed.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    join(outputDir, "RR-001-sandbox-receipt.json"),
    JSON.stringify(savedReceipt, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      reportSaved: true,
      receiptSaved: true,
      refundStatus: attempt.status,
      refundId: attempt.provider_refund_id,
      attemptCount: counts.attempts,
      repeatVerified: true,
      keysDisplayed: false,
    }),
  );
}
main()
  .catch(() => {
    console.error("SANDBOX_REPORT_FAILED");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
