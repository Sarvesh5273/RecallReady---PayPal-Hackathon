import { z } from "zod";
import { BusinessError } from "../errors";
import { decimalToMinor, minorToDecimal } from "../domain/money";
import type {
  PaymentAdapter,
  CaptureRecord,
  OrderRecord,
  RefundRecord,
} from "./payment";
import type { Attempt } from "../services/execution";
const BASE = "https://api-m.sandbox.paypal.com";
const SANDBOX_LINK_ORIGINS = new Set([BASE, "https://api.sandbox.paypal.com"]);
const amount = z.object({ value: z.string(), currency_code: z.string() });
const links = z.array(z.object({ href: z.string(), rel: z.string() }));
const captureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount,
  supplementary_data: z
    .object({ related_ids: z.object({ order_id: z.string() }) })
    .optional(),
});
const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        amount: amount.optional(),
        payee: z.object({ merchant_id: z.string() }),
        payments: z
          .object({
            captures: z.array(captureSchema),
            refunds: z.array(z.object({ id: z.string().min(1) })).optional(),
          })
          .optional(),
      }),
    )
    .length(1),
});
export function parsePayPalRefund(raw: unknown): RefundRecord {
  const refund = z
    .object({
      id: z.string().min(1),
      status: z.string(),
      amount,
      links,
      create_time: z.string().optional(),
    })
    .parse(raw);
  const up = refund.links.filter((l) => l.rel === "up");
  if (up.length !== 1) throw new Error("REFUND_CAPTURE_UNVERIFIED");
  const url = new URL(up[0].href);
  // Inspect the association only. Every network request still uses fixed BASE.
  if (
    !SANDBOX_LINK_ORIGINS.has(url.origin) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !/^\/v2\/payments\/captures\/[A-Za-z0-9_-]+$/.test(url.pathname)
  )
    throw new Error("REFUND_CAPTURE_UNVERIFIED");
  return {
    id: refund.id,
    captureId: url.pathname.split("/").at(-1)!,
    amountMinor: decimalToMinor(refund.amount.value),
    currency: refund.amount.currency_code,
    status: refund.status,
    createdAt: refund.create_time,
    raw,
  };
}
let token: { value: string; until: number } | null = null;
export function guardPayPal(mode: string) {
  if (
    mode !== "PAYPAL_SANDBOX" ||
    process.env.PAYPAL_ENV !== "sandbox" ||
    (process.env.PAYPAL_BASE_URL ?? BASE) !== BASE
  )
    throw new BusinessError(
      "SANDBOX_GUARD",
      "Only the fixed PayPal sandbox host is permitted.",
      503,
    );
}
export function sandboxConfigured() {
  return !!(
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET &&
    process.env.PAYPAL_EXPECTED_MERCHANT_ID
  );
}
async function limitedJSON(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_RESPONSE");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_048_576) {
      await reader.cancel();
      throw new Error("RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export class PayPalAdapter implements PaymentAdapter {
  mode = "PAYPAL_SANDBOX" as const;
  private preparedToken = "";
  constructor(mode: string) {
    guardPayPal(mode);
    if (!sandboxConfigured())
      throw new BusinessError(
        "PAYPAL_NOT_CONFIGURED",
        "Add sandbox credentials and expected merchant ID in the server environment.",
        503,
      );
  }
  async prepare() {
    guardPayPal(this.mode);
    if (!token || token.until < Date.now() + 30_000) {
      const response = await fetch(BASE + "/v1/oauth2/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!response.ok)
        throw new BusinessError(
          "PAYPAL_AUTH_FAILED",
          "Sandbox authentication failed.",
          503,
        );
      const data = z
        .object({ access_token: z.string(), expires_in: z.number() })
        .parse(await limitedJSON(response));
      token = {
        value: data.access_token,
        until: Date.now() + (data.expires_in - 60) * 1000,
      };
    }
    this.preparedToken = token.value;
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    requestId?: string,
  ) {
    guardPayPal(this.mode);
    if (!this.preparedToken) throw new Error("TOKEN_NOT_PREPARED");
    if (
      !/^\/v2\/(checkout\/orders|payments\/(captures|refunds))\//.test(path) &&
      path !== "/v2/checkout/orders"
    )
      throw new Error("UNEXPECTED_ENDPOINT");
    const response = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: "Bearer " + this.preparedToken,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok)
      throw new BusinessError(
        response.status === 422
          ? "PROVIDER_REJECTED"
          : "PROVIDER_OUTCOME_UNKNOWN",
        "PayPal did not return a verifiable result.",
        response.status === 422 ? 422 : 503,
      );
    return limitedJSON(response);
  }
  async createOrder(internalId: string, requestId: string) {
    await this.prepare();
    const raw = await this.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: internalId,
            custom_id: internalId,
            description: "RR-001 synthetic single-item sandbox purchase",
            payee: { merchant_id: process.env.PAYPAL_EXPECTED_MERCHANT_ID },
            amount: { currency_code: "USD", value: "49.00" },
          },
        ],
      },
      requestId,
    );
    const created = z.object({ id: z.string(), status: z.string() }).parse(raw);
    return { ...created, raw };
  }
  async captureOrder(id: string, requestId: string) {
    await this.prepare();
    await this.request(
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      "POST",
      {},
      requestId,
    );
    return this.getOrder(id);
  }
  async getOrder(id: string): Promise<OrderRecord> {
    const raw = await this.request(
      `/v2/checkout/orders/${encodeURIComponent(id)}`,
    );
    const order = orderSchema.parse(raw);
    const p = order.purchase_units[0];
    if (!p.amount || !p.custom_id || p.reference_id !== p.custom_id)
      throw new Error("ORDER_IDENTITY_UNVERIFIED");
    return {
      id: order.id,
      internalOrderId: p.custom_id,
      merchantId: p.payee.merchant_id,
      captureIds: p.payments?.captures.map((c) => c.id) ?? [],
      refundIds: p.payments?.refunds?.map((r) => r.id) ?? [],
      amountMinor: decimalToMinor(p.amount.value),
      currency: p.amount.currency_code,
      raw,
    };
  }
  async getCapture(id: string): Promise<CaptureRecord> {
    const raw = await this.request(
      `/v2/payments/captures/${encodeURIComponent(id)}`,
    );
    const capture = captureSchema.parse(raw);
    if (!capture.supplementary_data?.related_ids.order_id)
      throw new Error("CAPTURE_ORDER_UNVERIFIED");
    const order = await this.getOrder(
      capture.supplementary_data.related_ids.order_id,
    );
    return {
      id: capture.id,
      orderId: order.id,
      merchantId: order.merchantId,
      amountMinor: decimalToMinor(capture.amount.value),
      currency: capture.amount.currency_code,
      status: capture.status,
      raw,
    };
  }
  async refundCapture(attempt: Attempt) {
    return parsePayPalRefund(
      await this.request(
        `/v2/payments/captures/${encodeURIComponent(attempt.capture_id)}/refund`,
        "POST",
        {
          amount: {
            value: minorToDecimal(attempt.amount_minor),
            currency_code: "USD",
          },
          note_to_payer:
            "Harbor Demo Goods courtesy refund. Sandbox demonstration.",
        },
        attempt.paypal_request_id,
      ),
    );
  }
  async getRefund(id: string) {
    return parsePayPalRefund(
      await this.request(`/v2/payments/refunds/${encodeURIComponent(id)}`),
    );
  }
  async findRefund(
    order: OrderRecord,
    captureId: string,
    dispatchStartedAt: Date,
  ) {
    const ids = order.refundIds ?? [];
    if (!ids.length) return null;
    // Multiple refunds require investigation; do not guess which belongs to this attempt.
    if (ids.length !== 1) throw new Error("REFUND_DISCOVERY_AMBIGUOUS");
    const refund = await this.getRefund(ids[0]);
    const createdAt = Date.parse(refund.createdAt ?? "");
    if (
      refund.id !== ids[0] ||
      refund.captureId !== captureId ||
      !Number.isFinite(createdAt) ||
      createdAt < Math.floor(dispatchStartedAt.getTime() / 1000) * 1000 ||
      createdAt > Date.now() + 60000
    )
      throw new Error("REFUND_DISCOVERY_UNVERIFIED");
    return refund;
  }
}
