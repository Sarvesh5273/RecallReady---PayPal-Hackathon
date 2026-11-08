// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DemoSetup } from "../../components/demo-setup";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../../components/client-api", () => ({ api: vi.fn() }));
afterEach(cleanup);
it("restores the saved capture after page load and removes checkout", async () => {
  const { api } = await import("../../components/client-api");
  const buttons = vi.fn();
  window.paypal = { Buttons: buttons };
  vi.mocked(api).mockImplementation(async (path) =>
    path === "demo/evidence"
      ? []
      : {
          mode: "PAYPAL_SANDBOX",
          paypalReady: true,
          aiReady: true,
          aiProvider: "GEMINI",
          aiModel: "test-model",
          clientId: "test-client",
          purchase: {
            provider_order_id: "test-order",
            capture_id: "test-capture",
            verified_state: "COMPLETED",
            owned: true,
            amount_minor: "4900",
            currency: "USD",
            verified_at: new Date().toISOString(),
          },
        },
  );
  render(<DemoSetup />);
  expect(
    await screen.findByRole("heading", { name: "Sandbox purchase completed" }),
  ).toBeInTheDocument();
  expect(screen.getByText("test-capture")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Continue to source review" }),
  ).toHaveAttribute("href", "/sources");
  expect(document.querySelector('script[src*="paypal.com/sdk/js"]')).toBeNull();
  expect(buttons).not.toHaveBeenCalled();
});
