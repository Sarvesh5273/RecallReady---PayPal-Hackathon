import { pool, one, transaction } from "../../lib/db";
import {
  lockWorkspace,
  validateApproval,
  attemptState,
  enqueue,
  type Attempt,
} from "../../lib/services/execution";
import { loadCase } from "../../lib/services/cases";
import {
  verifyPayment,
  verifyRefund,
  type PaymentAdapter,
} from "../../lib/adapters/payment";
import { FixturePaymentAdapter } from "../../lib/adapters/fixture-payment";
import { PayPalAdapter } from "../../lib/adapters/paypal";
import { refundState, preserveTerminal } from "../../lib/domain/state-machines";
import { BusinessError } from "../../lib/errors";
import { fingerprint, sha256 } from "../../lib/domain/approvals";
import { randomUUID } from "node:crypto";
import { audit } from "../../lib/observability/audit";
export async function executeRefund(
  workspaceId: string,
  attemptId: string,
  injected?: PaymentAdapter,
) {
  let adapter: PaymentAdapter;
  const preflight = await transaction(async (db) => {
    await lockWorkspace(db, workspaceId);
    const a = await one<Attempt>(
      db,
      "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [attemptId, workspaceId],
    );
    if (
      !a ||
      a.dispatch_started_at ||
      !["RESERVED", "PREFLIGHT"].includes(a.status)
    )
      return null;
    try {
      const approved = await validateApproval(db, workspaceId, a.approval_id);
      await attemptState(db, a, "PREFLIGHT");
      return { attempt: a, row: approved.row };
    } catch (e) {
      await attemptState(db, a, "BLOCKED_BEFORE_DISPATCH", {
        failureCode: e instanceof BusinessError ? e.code : "PREFLIGHT_FAILED",
      });
      return null;
    }
  });
  if (!preflight) return;
  const { attempt, row } = preflight;
  if (
    row.mode === "SIMULATION" &&
    ["source_changes", "revoked"].includes(row.scenario)
  ) {
    await transaction(async (db) => {
      await lockWorkspace(db, workspaceId);
      const current = await one<Attempt>(
        db,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [attemptId, workspaceId],
      );
      if (
        !current ||
        current.dispatch_started_at ||
        current.status !== "PREFLIGHT"
      )
        return;
      if (row.scenario === "revoked") {
        await db.query(
          "UPDATE approvals SET revoked_at=now() WHERE id=$1 AND workspace_id=$2",
          [attempt.approval_id, workspaceId],
        );
      } else if (row.source_version_id === row.latest_source_id) {
        const documents = row.documents.map((d) => {
          const text = d.text + "\n\nSYNTHETIC SIMULATION SOURCE UPDATE";
          return { ...d, text, hash: sha256(text) };
        });
        await db.query(
          "INSERT INTO source_versions(id,workspace_id,source_id,version,raw_json,raw_snapshot,documents,content_hash,source_date,fetched_at,freshness_status,origin) SELECT $1,workspace_id,source_id,(SELECT max(version)+1 FROM source_versions WHERE source_id=$2 AND workspace_id=$3),raw_json || '{\"syntheticUpdate\":true}'::jsonb,raw_snapshot || E'\\nSYNTHETIC SIMULATION SOURCE UPDATE',$4,$5,source_date,now(),'CACHED_FIXTURE','SYNTHETIC_SOURCE_CHANGE' FROM source_versions WHERE id=$6 AND workspace_id=$3",
          [
            randomUUID(),
            row.source_id,
            workspaceId,
            JSON.stringify(documents),
            fingerprint(documents).hash,
            row.source_version_id,
          ],
        );
      }
      await audit(db, workspaceId, "SIMULATION_FAULT_INJECTED", attempt.id, {
        scenario: row.scenario,
        synthetic: true,
      });
    });
  }
  try {
    adapter =
      injected ??
      (row.mode === "SIMULATION"
        ? new FixturePaymentAdapter(row)
        : new PayPalAdapter(row.mode));
    if (adapter.mode !== row.mode) throw new Error("MODE_MISMATCH");
    await adapter.prepare();
    const order = await adapter.getOrder(row.provider_order_id!),
      capture = await adapter.getCapture(attempt.capture_id);
    verifyPayment(row, order, capture);
  } catch (e) {
    await transaction(async (db) => {
      await lockWorkspace(db, workspaceId);
      const current = await one<Attempt>(
        db,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2",
        [attemptId, workspaceId],
      );
      if (
        current &&
        !current.dispatch_started_at &&
        current.status === "PREFLIGHT"
      )
        await attemptState(db, current, "BLOCKED_BEFORE_DISPATCH", {
          failureCode:
            e instanceof BusinessError ? e.code : "PAYMENT_STATE_CHANGED",
        });
    });
    return;
  }
  const dispatch = await transaction(async (db) => {
    await lockWorkspace(db, workspaceId);
    const current = await one<Attempt>(
      db,
      "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [attemptId, workspaceId],
    );
    if (
      !current ||
      current.dispatch_started_at ||
      current.status !== "PREFLIGHT"
    )
      return false;
    try {
      await validateApproval(db, workspaceId, current.approval_id);
    } catch (e) {
      await attemptState(db, current, "BLOCKED_BEFORE_DISPATCH", {
        failureCode: e instanceof BusinessError ? e.code : "APPROVAL_STALE",
      });
      return false;
    }
    const updated = await db.query(
      "UPDATE payment_attempts SET dispatch_started_at=now(),status='DISPATCHING',updated_at=now() WHERE id=$1 AND workspace_id=$2 AND dispatch_started_at IS NULL AND status='PREFLIGHT'",
      [attemptId, workspaceId],
    );
    if (updated.rowCount !== 1) return false;
    await attemptState(db, current, "DISPATCHING");
    return true;
  });
  if (!dispatch) return;
  try {
    const response = await adapter.refundCapture(attempt);
    verifyRefund(attempt, response);
    // GET the known refund before displaying completion. Persist the POST record first.
    await transaction(async (db) => {
      await lockWorkspace(db, workspaceId);
      const current = await one<Attempt>(
        db,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [attemptId, workspaceId],
      );
      if (!current) return;
      await attemptState(db, current, "PROVIDER_PENDING", {
        refundId: response.id,
        providerStatus: response.status,
        snapshot: response.raw,
      });
      await enqueue(db, workspaceId, "RECONCILE_REFUND", { attemptId });
    });
    await reconcileRefund(workspaceId, attemptId, adapter);
  } catch (e) {
    await transaction(async (db) => {
      await lockWorkspace(db, workspaceId);
      const current = await one<Attempt>(
        db,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [attemptId, workspaceId],
      );
      if (
        current &&
        !["COMPLETED", "FAILED_FINAL", "CANCELLED_FINAL"].includes(
          current.status,
        )
      )
        await attemptState(db, current, "OUTCOME_UNKNOWN", {
          failureCode: e instanceof BusinessError ? e.code : "OUTCOME_UNKNOWN",
        });
    });
  }
}
export async function reconcileRefund(
  workspaceId: string,
  attemptId: string,
  injected?: PaymentAdapter,
) {
  const a = await one<Attempt>(
    pool,
    "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2",
    [attemptId, workspaceId],
  );
  if (!a || ["COMPLETED", "FAILED_FINAL", "CANCELLED_FINAL"].includes(a.status))
    return;
  const row = await loadCase(pool, workspaceId, a.case_id);
  const adapter: PaymentAdapter =
    injected ??
    (row.mode === "SIMULATION"
      ? new FixturePaymentAdapter(row)
      : new PayPalAdapter(row.mode));
  if (adapter.mode !== a.mode) throw new Error("MODE_MISMATCH");
  try {
    await adapter.prepare();
    let refund;
    let discovered = false;
    if (!a.provider_refund_id) {
      const order = await adapter.getOrder(row.provider_order_id!);
      const capture = await adapter.getCapture(a.capture_id);
      if (
        !adapter.findRefund ||
        !a.dispatch_started_at ||
        !row.owned ||
        !["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(
          capture.status,
        )
      )
        return;
      verifyPayment(row, order, { ...capture, status: "COMPLETED" });
      refund = await adapter.findRefund(
        order,
        a.capture_id,
        new Date(a.dispatch_started_at),
      );
      if (!refund) return;
      discovered = true;
    } else {
      refund = await adapter.getRefund(a.provider_refund_id);
    }
    verifyRefund(a, refund);
    if (a.provider_refund_id && refund.id !== a.provider_refund_id)
      throw new Error("REFUND_IDENTITY_MISMATCH");
    await transaction(async (db) => {
      await lockWorkspace(db, workspaceId);
      const current = await one<Attempt>(
        db,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [attemptId, workspaceId],
      );
      if (!current) return;
      if (
        current.provider_refund_id &&
        current.provider_refund_id !== refund.id
      )
        throw new Error("REFUND_IDENTITY_MISMATCH");
      if (discovered)
        await audit(
          db,
          workspaceId,
          "REFUND_DISCOVERED_BY_GET",
          current.id,
          {
            providerRefundId: refund.id,
            captureId: refund.captureId,
            source: "OWNED_ORDER_AND_REFUND_GET",
            providerWrites: 0,
          },
          "worker",
          current.correlation_id,
        );
      const status = preserveTerminal(
        current.status,
        refundState(refund.status),
      );
      await attemptState(db, current, status, {
        refundId: refund.id,
        providerStatus: refund.status,
        snapshot: refund.raw,
      });
      await db.query(
        "UPDATE payment_attempts SET verification_stale=false WHERE id=$1 AND workspace_id=$2",
        [attemptId, workspaceId],
      );
      if (status === "PROVIDER_PENDING")
        await enqueue(db, workspaceId, "RECONCILE_REFUND", { attemptId }, 30);
      if (status === "COMPLETED")
        await db.query(
          "UPDATE payment_links SET verified_state='REFUNDED',verified_at=now() WHERE id=$1 AND workspace_id=$2",
          [row.payment_link_id, workspaceId],
        );
    });
  } catch {
    await pool.query(
      "UPDATE payment_attempts SET verification_stale=true WHERE id=$1 AND workspace_id=$2",
      [attemptId, workspaceId],
    );
    throw new BusinessError(
      "VERIFICATION_UNAVAILABLE",
      "Provider verification is unavailable. The last known state is preserved.",
      503,
    );
  }
}
export async function recoverDispatches() {
  const rows = (
    await pool.query(
      "SELECT * FROM payment_attempts WHERE status='DISPATCHING' AND dispatch_started_at<now()-interval '60 seconds' LIMIT 100",
    )
  ).rows as Attempt[];
  for (const row of rows)
    await transaction(async (db) => {
      await lockWorkspace(db, row.workspace_id);
      const current = await one<Attempt>(
        db,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2 AND status='DISPATCHING' FOR UPDATE",
        [row.id, row.workspace_id],
      );
      if (current)
        await attemptState(db, current, "OUTCOME_UNKNOWN", {
          failureCode: "WORKER_DISPATCH_INTERRUPTED",
        });
    });
}
