import { randomUUID } from "node:crypto";
import { pool, one, transaction } from "../db";
import type { Actor } from "../auth/session";
import { rateLimit } from "../auth/session";
import { PayPalAdapter } from "../adapters/paypal";
import { verifyPayment } from "../adapters/payment";
import { loadCase } from "./cases";
import { lockWorkspace } from "./execution";
import { audit } from "../observability/audit";
import { BusinessError, notFound } from "../errors";
type Link = {
  id: string;
  order_id: string;
  provider_order_id: string | null;
  create_request_id: string;
  capture_request_id: string;
  verified_state: string;
};
export async function createSandboxOrder(actor: Actor) {
  if (actor.mode !== "PAYPAL_SANDBOX")
    throw new BusinessError(
      "MODE_MISMATCH",
      "Sign in to a sandbox workspace first.",
      422,
    );
  const adapter = new PayPalAdapter(actor.mode);
  const reservation = await transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    const c = await one<{ id: string }>(
      db,
      "SELECT c.id FROM cases c JOIN order_items i ON i.id=c.order_item_id JOIN orders o ON o.id=i.order_id WHERE c.workspace_id=$1 AND o.workspace_id=$1 AND o.display_id='RR-001'",
      [actor.workspaceId],
    );
    if (!c) notFound();
    const row = await loadCase(db, actor.workspaceId, c.id);
    const existing = await one<Link>(
      db,
      "SELECT * FROM payment_links WHERE order_id=$1 AND workspace_id=$2",
      [row.order_id, actor.workspaceId],
    );
    if (existing) {
      if (existing.provider_order_id)
        return { existing: existing.provider_order_id };
      throw new BusinessError(
        "SETUP_OUTCOME_UNKNOWN",
        "Order creation was already reserved. Inspect PayPal before another setup.",
      );
    }
    await rateLimit(
      db,
      "setup:" + actor.workspaceId,
      Math.min(Number(process.env.SANDBOX_DAILY_ORDER_QUOTA ?? 5), 5),
      86400,
    );
    const link = {
      id: randomUUID(),
      createRequest: randomUUID(),
      captureRequest: randomUUID(),
    };
    await db.query(
      "INSERT INTO payment_links(id,workspace_id,mode,order_id,merchant_id,amount_minor,currency,verified_state,create_request_id,capture_request_id) VALUES($1,$2,'PAYPAL_SANDBOX',$3,$4,4900,'USD','CREATING',$5,$6)",
      [
        link.id,
        actor.workspaceId,
        row.order_id,
        actor.merchantId,
        link.createRequest,
        link.captureRequest,
      ],
    );
    return { row, link };
  });
  if ("existing" in reservation) return { orderId: reservation.existing };
  const result = await adapter.createOrder(
    reservation.row.order_id,
    reservation.link.createRequest,
  );
  await transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    await db.query(
      "UPDATE payment_links SET provider_order_id=$1,verified_state='ORDER_CREATED',last_snapshot=$2 WHERE id=$3 AND workspace_id=$4",
      [
        result.id,
        JSON.stringify(result.raw),
        reservation.link.id,
        actor.workspaceId,
      ],
    );
    await audit(
      db,
      actor.workspaceId,
      "SANDBOX_ORDER_CREATED",
      reservation.row.id,
      { providerOrderId: result.id, amountMinor: "4900" },
      actor.userId,
    );
  });
  return { orderId: result.id };
}
export async function captureSandboxOrder(actor: Actor, orderId: string) {
  if (actor.mode !== "PAYPAL_SANDBOX")
    throw new BusinessError(
      "MODE_MISMATCH",
      "Sandbox workspace required.",
      422,
    );
  const adapter = new PayPalAdapter(actor.mode);
  const reserved = await transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    const link = await one<Link>(
      db,
      "SELECT * FROM payment_links WHERE provider_order_id=$1 AND workspace_id=$2 AND mode=$3 FOR UPDATE",
      [orderId, actor.workspaceId, actor.mode],
    );
    if (!link) notFound();
    if (
      link.verified_state === "COMPLETED" ||
      link.verified_state === "REFUNDED"
    )
      return { done: true, link };
    if (link.verified_state !== "ORDER_CREATED")
      throw new BusinessError(
        "SETUP_OUTCOME_UNKNOWN",
        "Capture is already reserved or needs investigation.",
      );
    await db.query(
      "UPDATE payment_links SET verified_state='CAPTURING' WHERE id=$1 AND workspace_id=$2",
      [link.id, actor.workspaceId],
    );
    return { done: false, link };
  });
  if (reserved.done) return { status: reserved.link.verified_state };
  const order = await adapter.captureOrder(
    orderId,
    reserved.link.capture_request_id,
  );
  if (order.captureIds.length !== 1)
    throw new BusinessError(
      "CAPTURE_UNVERIFIED",
      "One verified capture is required.",
    );
  const capture = await adapter.getCapture(order.captureIds[0]);
  const c = await one<{ id: string }>(
    pool,
    "SELECT c.id FROM cases c JOIN order_items i ON i.id=c.order_item_id WHERE i.order_id=$1 AND c.workspace_id=$2",
    [reserved.link.order_id, actor.workspaceId],
  );
  if (!c) notFound();
  const row = await loadCase(pool, actor.workspaceId, c.id);
  verifyPayment(
    { ...row, capture_id: capture.id, amount_minor: "4900" },
    order,
    capture,
  );
  await transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    await db.query(
      "UPDATE payment_links SET capture_id=$1,owned=true,verified_state='COMPLETED',last_snapshot=$2,verified_at=now() WHERE id=$3 AND workspace_id=$4 AND verified_state='CAPTURING'",
      [
        capture.id,
        JSON.stringify({ order: order.raw, capture: capture.raw }),
        reserved.link.id,
        actor.workspaceId,
      ],
    );
    await db.query(
      "UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id=$2",
      [c.id, actor.workspaceId],
    );
    await audit(
      db,
      actor.workspaceId,
      "SANDBOX_CAPTURE_VERIFIED",
      c.id,
      {
        providerOrderId: order.id,
        captureId: capture.id,
        amountMinor: capture.amountMinor,
      },
      actor.userId,
    );
  });
  return { status: "COMPLETED", captureId: capture.id };
}
