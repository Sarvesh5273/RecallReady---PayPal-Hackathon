"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "./client-api";
import { usd } from "@/lib/domain/money";
export type ProposalView = {
  id: string;
  fingerprint: string;
  expires_at: string;
  amount_minor: string;
  currency: string;
  capture_id: string;
  provider_order_id: string;
  merchant: string;
  canonical: string;
  rule_revision: number;
  policy_revision: number;
};
export function ApprovalDialog({
  proposal,
  onDone,
  onCancel,
  mode,
}: {
  proposal: ProposalView;
  onDone: (attemptId: string) => void;
  onCancel: () => void;
  mode: string;
}) {
  const [checked, setChecked] = useState(false),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="approval-box" aria-labelledby="approval-title">
      <h3 id="approval-title">Review courtesy refund approval</h3>
      <p>
        <strong>
          {proposal.merchant} · {usd(proposal.amount_minor)} {proposal.currency}
        </strong>
      </p>
      <div className="payment-id">
        Capture: {proposal.capture_id}
        <br />
        Order: {proposal.provider_order_id}
      </div>
      <p>
        Rule r{proposal.rule_revision} · Policy v{proposal.policy_revision}
        <br />
        Expires: {new Date(proposal.expires_at).toLocaleTimeString()}
      </p>
      <details>
        <summary className="hash">Immutable approval fingerprint</summary>
        <p className="hash">{proposal.fingerprint}</p>
        <pre className="hash">
          {JSON.stringify(JSON.parse(proposal.canonical), null, 2)}
        </pre>
      </details>
      <p>
        This approves a voluntary courtesy refund under the demo merchant
        policy. It does not submit or complete a manufacturer recall claim.{" "}
        {mode === "SIMULATION"
          ? "This action is simulated. No PayPal request is made."
          : "This action uses PayPal sandbox funds only."}
      </p>
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I reviewed the evidence, merchant basis, and exact amount.
      </label>
      <details className="approval-note">
        <summary>Optional operator note</summary>
        <label htmlFor="approval-note">Operator note</label>
        <textarea
          id="approval-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
        />
      </details>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={!checked || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const approval = await api<{ id: string }>(
                `proposals/${proposal.id}/approve`,
                {
                  proposalFingerprint: proposal.fingerprint,
                  confirmation: true,
                  note,
                },
              );
              const attempt = await api<{ id: string }>(
                `approvals/${approval.id}/execute`,
                {},
              );
              onDone(attempt.id);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <ShieldCheck size={13} />
          {busy ? "Recording approval…" : "Approve courtesy refund"}
        </button>
        <button className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
