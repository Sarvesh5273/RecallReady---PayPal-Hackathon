import type { Mode } from "../domain/types";
import type { CaseContext } from "../services/cases";
import type { Attempt } from "../services/execution";
export type CaptureRecord = {
  id: string;
  orderId: string;
  merchantId: string;
  amountMinor: string;
  currency: string;
  status: string;
  raw: unknown;
};
export type OrderRecord = {
  id: string;
  internalOrderId: string;
  merchantId: string;
  captureIds: string[];
  refundIds?: string[];
  amountMinor: string;
  currency: string;
  raw: unknown;
};
export type RefundRecord = {
  id: string;
  captureId: string;
  amountMinor: string;
  currency: string;
  status: string;
  createdAt?: string;
  raw: unknown;
};
export interface PaymentAdapter {
  mode: Mode;
  prepare(): Promise<void>;
  getOrder(id: string): Promise<OrderRecord>;
  getCapture(id: string): Promise<CaptureRecord>;
  refundCapture(attempt: Attempt): Promise<RefundRecord>;
  getRefund(id: string): Promise<RefundRecord>;
  findRefund?(
    order: OrderRecord,
    captureId: string,
    dispatchStartedAt: Date,
  ): Promise<RefundRecord | null>;
}
export function verifyPayment(
  row: CaseContext,
  order: OrderRecord,
  capture: CaptureRecord,
) {
  if (
    order.id !== row.provider_order_id ||
    order.internalOrderId !== row.order_id ||
    order.merchantId !== row.expected_merchant_id ||
    capture.merchantId !== row.expected_merchant_id ||
    !order.captureIds.includes(capture.id) ||
    capture.id !== row.capture_id ||
    capture.orderId !== order.id ||
    order.amountMinor !== row.total_minor ||
    capture.amountMinor !== row.amount_minor ||
    order.currency !== row.currency ||
    capture.currency !== row.currency ||
    capture.status !== "COMPLETED"
  )
    throw new Error("PAYMENT_STATE_CHANGED");
}
export function verifyRefund(attempt: Attempt, refund: RefundRecord) {
  if (
    !refund.id ||
    refund.captureId !== attempt.capture_id ||
    refund.amountMinor !== attempt.amount_minor ||
    refund.currency !== attempt.currency
  )
    throw new Error("REFUND_IDENTITY_MISMATCH");
}
