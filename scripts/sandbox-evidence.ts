import "dotenv/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, one, transaction } from "../lib/db";
import type { Attempt } from "../lib/services/execution";
import { loadCase } from "../lib/services/cases";
import { PayPalAdapter } from "../lib/adapters/paypal";
import { verifyRefund } from "../lib/adapters/payment";
import { audit } from "../lib/observability/audit";
async function main() {
  const index = process.argv.indexOf("--attempt");
  const attemptId = z
    .string()
    .uuid()
    .parse(process.argv[index + 1]);
  const a = await one<Attempt>(
    pool,
    "SELECT * FROM payment_attempts WHERE id=$1 AND mode='PAYPAL_SANDBOX' AND status='COMPLETED'",
    [attemptId],
  );
  if (!a || !a.provider_refund_id)
    throw new Error("No completed genuine sandbox attempt.");
  const row = await loadCase(pool, a.workspace_id, a.case_id);
  const adapter = new PayPalAdapter("PAYPAL_SANDBOX");
  await adapter.prepare();
  const order = await adapter.getOrder(row.provider_order_id!),
    capture = await adapter.getCapture(a.capture_id),
    refund = await adapter.getRefund(a.provider_refund_id);
  verifyRefund(a, refund);
  if (
    refund.status !== "COMPLETED" ||
    order.merchantId !== row.expected_merchant_id ||
    order.internalOrderId !== row.order_id ||
    !order.captureIds.includes(capture.id) ||
    capture.id !== a.capture_id ||
    capture.orderId !== order.id ||
    capture.amountMinor !== a.amount_minor ||
    capture.currency !== "USD"
  )
    throw new Error("Provider evidence identity validation failed.");
  const evidence = {
    mode: "RECORDED_SANDBOX_EVIDENCE",
    orderId: order.id,
    captureId: capture.id,
    refundId: refund.id,
    refundStatus: refund.status,
    captureStatus: capture.status,
    amountMinor: a.amount_minor,
    currency: a.currency,
    sourceHash: row.content_hash,
    ruleHash: row.rule_hash,
    approvalId: a.approval_id,
    attemptId: a.id,
    verifiedAt: new Date().toISOString(),
    manufacturerClaimSubmitted: false,
  };
  const build = process.env.BUILD_COMMIT ?? "UNTAGGED_LOCAL_BUILD";
  const recovered = await one(
    pool,
    "SELECT id FROM audit_events WHERE workspace_id=$1 AND entity_id=$2 AND event_type='REFUND_DISCOVERED_BY_GET' LIMIT 1",
    [a.workspace_id, a.id],
  );
  const recordedEvidence = {
    ...evidence,
    verificationMethod: recovered
      ? "ORDER_AND_REFUND_GET_RECOVERY"
      : "POST_THEN_REFUND_GET",
  };
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO demo_evidence_runs(id,workspace_id,mode,case_id,attempt_id,evidence,build_commit) VALUES($1,$2,'RECORDED_SANDBOX_EVIDENCE',$3,$4,$5,$6)",
      [
        randomUUID(),
        a.workspace_id,
        a.case_id,
        a.id,
        JSON.stringify(recordedEvidence),
        build,
      ],
    );
    await audit(db, a.workspace_id, "SANDBOX_EVIDENCE_RECORDED", a.id, {
      buildCommit: build,
      refundStatus: refund.status,
    });
  });
  console.log("Saved provider-backed recorded evidence. Provider writes: 0.");
}
main()
  .catch(() => {
    console.error(
      "Recording failed. Supply a completed sandbox attempt and valid server credentials. No refund write was made.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
