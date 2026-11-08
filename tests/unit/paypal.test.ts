import { afterEach, expect, it, vi } from "vitest";
import { parsePayPalRefund, PayPalAdapter } from "../../lib/adapters/paypal";
import type { OrderRecord } from "../../lib/adapters/payment";
const raw = (origin: string) => ({
  id: "refund-1",
  status: "COMPLETED",
  amount: { value: "49.00", currency_code: "USD" },
  create_time: "2026-11-08T08:59:15Z",
  links: [{ rel: "up", href: origin + "/v2/payments/captures/capture-1" }],
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["https://api-m.sandbox.paypal.com", "https://api.sandbox.paypal.com"])(
  "accepts the official sandbox capture association %s",
  (origin) => {
    expect(parsePayPalRefund(raw(origin))).toMatchObject({
      id: "refund-1",
      captureId: "capture-1",
      amountMinor: "4900",
      status: "COMPLETED",
    });
  },
);
it.each([
  "https://api.paypal.com",
  "https://api-m.paypal.com",
  "http://api.sandbox.paypal.com",
  "https://api.sandbox.paypal.com.evil.test",
  "https://evil.test",
  "https://api.sandbox.paypal.com:8443",
])("rejects refund association outside the sandbox origins %s", (origin) => {
  expect(() => parsePayPalRefund(raw(origin))).toThrow(
    "REFUND_CAPTURE_UNVERIFIED",
  );
});
it.each([
  "https://user:password@api.sandbox.paypal.com/v2/payments/captures/capture-1",
  "https://api.sandbox.paypal.com/v2/payments/captures/capture-1?x=1",
  "https://api.sandbox.paypal.com/v2/payments/captures/capture-1#x",
  "https://api.sandbox.paypal.com/v2/checkout/orders/order-1",
])("rejects an unsafe capture association %s", (href) => {
  const r = raw("https://api.sandbox.paypal.com");
  r.links[0].href = href;
  expect(() => parsePayPalRefund(r)).toThrow("REFUND_CAPTURE_UNVERIFIED");
});
const order: OrderRecord = {
  id: "order-1",
  internalOrderId: "internal-1",
  merchantId: "merchant-1",
  captureIds: ["capture-1"],
  refundIds: ["refund-1"],
  amountMinor: "4900",
  currency: "USD",
  raw: {},
};
function adapter() {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com");
  vi.stubEnv("PAYPAL_CLIENT_ID", "test-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-secret");
  vi.stubEnv("PAYPAL_EXPECTED_MERCHANT_ID", "test-merchant");
  return new PayPalAdapter("PAYPAL_SANDBOX");
}
it("discovers only a known order refund through GET after dispatch", async () => {
  const a = adapter();
  const get = vi
    .spyOn(a, "getRefund")
    .mockResolvedValue(
      parsePayPalRefund(raw("https://api.sandbox.paypal.com")),
    );
  const post = vi.spyOn(a, "refundCapture");
  const result = await a.findRefund(
    order,
    "capture-1",
    new Date("2026-11-08T08:59:13.999Z"),
  );
  expect(result?.id).toBe("refund-1");
  expect(get).toHaveBeenCalledWith("refund-1");
  expect(post).not.toHaveBeenCalled();
});
it("cannot attribute an earlier refund or another capture to this dispatch", async () => {
  const a = adapter();
  vi.spyOn(a, "getRefund").mockResolvedValue(
    parsePayPalRefund(raw("https://api.sandbox.paypal.com")),
  );
  await expect(
    a.findRefund(order, "capture-1", new Date("2026-11-08T09:00:00Z")),
  ).rejects.toThrow("REFUND_DISCOVERY_UNVERIFIED");
  await expect(
    a.findRefund(order, "capture-other", new Date("2026-11-08T08:59:13Z")),
  ).rejects.toThrow("REFUND_DISCOVERY_UNVERIFIED");
});
it("does not guess between multiple refunds or manufacture a missing refund", async () => {
  const a = adapter();
  const get = vi.spyOn(a, "getRefund");
  expect(
    await a.findRefund({ ...order, refundIds: [] }, "capture-1", new Date()),
  ).toBeNull();
  await expect(
    a.findRefund({ ...order, refundIds: ["a", "b"] }, "capture-1", new Date()),
  ).rejects.toThrow("REFUND_DISCOVERY_AMBIGUOUS");
  expect(get).not.toHaveBeenCalled();
});
