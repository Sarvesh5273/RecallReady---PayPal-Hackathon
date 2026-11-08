// @vitest-environment jsdom
import { it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApprovalDialog } from "../../components/approval-dialog";
it("requires deliberate confirmation and labels the simulation boundary", () => {
  render(
    <ApprovalDialog
      mode="SIMULATION"
      onCancel={() => {}}
      onDone={() => {}}
      proposal={{
        id: "p",
        fingerprint: "f".repeat(64),
        expires_at: new Date(Date.now() + 600000).toISOString(),
        amount_minor: "4900",
        currency: "USD",
        capture_id: "SIM_CAPTURE",
        provider_order_id: "SIM_ORDER",
        merchant: "Harbor Demo Goods",
        canonical: "{}",
        rule_revision: 1,
        policy_revision: 1,
      }}
    />,
  );
  const button = screen.getByRole("button", {
    name: "Approve courtesy refund",
  });
  expect(button).toBeDisabled();
  expect(screen.getByText(/No PayPal request is made/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button).toBeEnabled();
});
