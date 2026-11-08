import { randomUUID } from "node:crypto";
import { pool, one } from "../db";
import { loadCase, type CaseContext } from "../services/cases";
import type { Attempt } from "../services/execution";
import type {
  PaymentAdapter,
  OrderRecord,
  CaptureRecord,
  RefundRecord,
} from "./payment";
export class FixturePaymentAdapter implements PaymentAdapter {
  mode = "SIMULATION" as const;
  constructor(private row: CaseContext) {
    if (row.mode !== "SIMULATION") throw new Error("MODE_MISMATCH");
  }
  async prepare() {}
  async getOrder(id: string): Promise<OrderRecord> {
    const row = await loadCase(pool, this.row.workspace_id, this.row.id);
    return {
      id,
      internalOrderId: row.order_id,
      merchantId: row.expected_merchant_id,
      captureIds: [row.capture_id!],
      amountMinor: row.total_minor,
      currency: row.currency,
      raw: { simulation: true, id },
    };
  }
  async getCapture(id: string): Promise<CaptureRecord> {
    const row = await loadCase(pool, this.row.workspace_id, this.row.id);
    return {
      id,
      orderId: row.provider_order_id!,
      merchantId: row.expected_merchant_id,
      amountMinor: row.amount_minor!,
      currency: row.currency,
      status: row.verified_state!,
      raw: { simulation: true, id, status: row.verified_state },
    };
  }
  async refundCapture(attempt: Attempt): Promise<RefundRecord> {
    await pool.query(
      "INSERT INTO fixture_provider_events(id,workspace_id,attempt_id,operation) VALUES($1,$2,$3,$4)",
      [randomUUID(), attempt.workspace_id, attempt.id, "REFUND_POST"],
    );
    if (this.row.scenario === "timeout")
      throw new Error("SIMULATED_TIMEOUT_AFTER_ACCEPTANCE");
    const status =
      this.row.scenario === "provider_pending" ? "PENDING" : "COMPLETED";
    return {
      id: `SIM_REFUND_${attempt.workspace_id}_${attempt.id}`,
      captureId: attempt.capture_id,
      amountMinor: attempt.amount_minor,
      currency: attempt.currency,
      status,
      raw: {
        simulation: true,
        id: `SIM_REFUND_${attempt.workspace_id}_${attempt.id}`,
        status,
      },
    };
  }
  async getRefund(id: string): Promise<RefundRecord> {
    const a = await one<Attempt>(
      pool,
      "SELECT * FROM payment_attempts WHERE provider_refund_id=$1 AND workspace_id=$2",
      [id, this.row.workspace_id],
    );
    if (!a) throw new Error("SIM_REFUND_NOT_FOUND");
    return {
      id,
      captureId: a.capture_id,
      amountMinor: a.amount_minor,
      currency: a.currency,
      status: "COMPLETED",
      raw: { simulation: true, id, status: "COMPLETED" },
    };
  }
}
