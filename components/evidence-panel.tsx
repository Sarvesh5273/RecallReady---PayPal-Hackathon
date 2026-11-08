"use client";
import { useState, useEffect, useCallback } from "react";
import {
  ArrowUpRight,
  Check,
  ShieldCheck,
  Download,
  RefreshCw,
} from "lucide-react";
import type { CaseContext } from "@/lib/services/cases";
import { usd, minorToDecimal } from "@/lib/domain/money";
import { MatchTag, PaymentTag, reasonText } from "./case-grid";
import { ApprovalDialog, type ProposalView } from "./approval-dialog";
import { api } from "./client-api";
type Detail = CaseContext & {
  permission: { eligible: boolean; reasons: string[] };
  events: {
    event_type: string;
    created_at: string;
    details: Record<string, unknown>;
  }[];
};
type Action = {
  id: string;
  approval_id: string;
  status: string;
  provider_refund_id: string | null;
  provider_status: string | null;
  verification_stale: boolean;
  failure_code: string | null;
};
function Step({
  number,
  children,
}: {
  number: number;
  children: React.ReactNode;
}) {
  return (
    <div className="step-label">
      <span>{number}</span>
      <h3>{children}</h3>
    </div>
  );
}
export function EvidencePanel({
  id,
  onUpdated,
}: {
  id: string;
  onUpdated?: () => void;
}) {
  const [c, setCase] = useState<Detail | null>(null),
    [attempt, setAttempt] = useState<Action | null>(null),
    [proposal, setProposal] = useState<ProposalView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [repeat, setRepeat] = useState("");
  const refresh = useCallback(async () => {
    const detail = await api<Detail>(`cases/${id}`);
    setCase(detail);
    if (detail.attempt_id)
      setAttempt(await api<Action>(`attempts/${detail.attempt_id}`));
    else setAttempt(null);
  }, [id]);
  useEffect(() => {
    setCase(null);
    setProposal(null);
    setAttempt(null);
    setRepeat("");
    setError("");
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (
      !attempt ||
      !["RESERVED", "PREFLIGHT", "DISPATCHING", "PROVIDER_PENDING"].includes(
        attempt.status,
      )
    )
      return;
    const interval = setInterval(() => {
      refresh()
        .then(() => onUpdated?.())
        .catch((e) => setError(e.message));
    }, 1300);
    return () => clearInterval(interval);
  }, [attempt, refresh, onUpdated]);
  if (!c)
    return (
      <aside className="detail-panel">
        <div className="loading">{error || "Loading case evidence…"}</div>
      </aside>
    );
  const state = c.match_state,
    mode = c.mode,
    sourceText = c.documents.find((d) => d.id === "notice")?.text ?? "";
  const remedy =
    sourceText.match(/Consumers should immediately[^\n]+/)?.[0] ??
    "Review the official notice for instructions.";
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="detail-panel" aria-label="Case evidence and action">
      <header className="detail-title">
        <div>
          <small>CASE DETAIL</small>
          <h2>{c.display_id}</h2>
        </div>
        <MatchTag state={state} />
      </header>
      <div className="detail-body">
        <div
          className={
            "case-next-step " + (state === "NEEDS_REVIEW" ? "amber" : "")
          }
        >
          <p className="eyebrow">
            {attempt ? "PAYMENT STATUS" : "NEXT ACTION"}
          </p>
          <strong>
            {attempt?.status === "COMPLETED"
              ? "Refund complete. Receipt ready."
              : attempt?.status === "OUTCOME_UNKNOWN"
                ? "Check the outcome. Keep this attempt."
                : attempt
                  ? "Your approved refund is being tracked."
                  : c.permission.eligible
                    ? "Ready for your refund review."
                    : state === "NEEDS_REVIEW"
                      ? "More product evidence is needed."
                      : state === "NOT_MATCHED_TO_NOTICE"
                        ? "This model is outside the reviewed rule."
                        : "Review the prerequisites below."}
          </strong>
        </div>
        <div className="case-review-layout">
          <div className="case-evidence">
            <Step number={1}>Product evidence</Step>
            <div className="product-summary">
              <div className="product-art" aria-hidden="true">
                <div className="powerbank" />
              </div>
              <div>
                <strong>{c.title}</strong>
                <small>
                  {c.brand ?? "Brand missing"} · {c.model ?? "Model missing"}
                </small>
                <small>{c.customer_label} · Synthetic order</small>
              </div>
            </div>
            <dl className="facts">
              <div>
                <dt>MODEL IDENTIFIER</dt>
                <dd>{c.model ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>ORDER TOTAL</dt>
                <dd>
                  {c.currency} {minorToDecimal(c.total_minor)}
                </dd>
              </div>
              <div>
                <dt>QUANTITY</dt>
                <dd>{c.quantity}</dd>
              </div>
              <div>
                <dt>SERIAL</dt>
                <dd>{c.serial ?? "Not recorded"}</dd>
              </div>
            </dl>
            {c.customer_note && (
              <p className="section-description">
                Untrusted customer note: {c.customer_note}
              </p>
            )}
            <div
              className={
                "match-box " +
                (state === "NEEDS_REVIEW"
                  ? "amber"
                  : state === "EXACT_MATCH"
                    ? ""
                    : "muted")
              }
            >
              <Step number={2}>Deterministic match</Step>
              <MatchTag state={state} />
              <ul className="reason-list">
                {c.match_reasons.map((r) => (
                  <li key={r}>
                    <Check size={10} />
                    {reasonText[r] ?? r}
                  </li>
                ))}
              </ul>
            </div>
            <div className="detail-divider">
              <Step number={3}>Official source evidence</Step>
              {c.rule.serialRule.evidence.slice(0, 1).map((e, i) => (
                <blockquote className="source-quote" key={i}>
                  “{e.quote}”
                  <small>
                    Official CPSC notice · Reviewed rule r{c.rule_revision}
                  </small>
                </blockquote>
              ))}
              <a
                className="notice-link"
                target="_blank"
                rel="noreferrer"
                href={c.canonical_url}
              >
                Open official notice <ArrowUpRight size={12} />
              </a>
            </div>
            <div className="detail-divider">
              <Step number={4}>Official manufacturer remedy</Step>
              <span className="tag amber">External follow-up required</span>
              <p className="remedy-note">
                {remedy
                  .split(/(?<=\.)\s+/)
                  .slice(0, 2)
                  .join(" ")}
              </p>
              <details className="evidence-disclosure">
                <summary>Full manufacturer instructions</summary>
                <p className="remedy-note">{remedy}</p>
              </details>
              <p className="remedy-note">
                <strong>
                  No manufacturer claim has been submitted by RecallReady.
                </strong>
              </p>
            </div>
          </div>
          <div className="case-action">
            <div className="detail-divider">
              <Step number={5}>Merchant courtesy decision</Step>
              <div className="policy-box">
                <div className="policy-row">
                  <div>
                    <h3>Harbor courtesy policy</h3>
                    <small>
                      Independent demo policy · v{c.policy_revision}
                    </small>
                  </div>
                  <strong>{usd(c.amount_minor ?? c.total_minor)}</strong>
                </div>
                {c.permission.eligible ? (
                  <span className="tag green">
                    Eligible for operator approval
                  </span>
                ) : (
                  <span className={"tag " + (attempt ? "muted" : "amber")}>
                    {attempt
                      ? attempt.status === "COMPLETED"
                        ? "Courtesy refund completed"
                        : "This payment has an existing attempt"
                      : "Courtesy action not eligible"}
                  </span>
                )}
                <p className="remedy-note">
                  Requirements at approval: one item, quantity one, USD, an
                  owned completed capture, and no prior refund.
                </p>
                {!c.permission.eligible && !attempt && (
                  <ul className="reason-list">
                    {c.permission.reasons.map((r) => (
                      <li key={r}>{reasonText[r] ?? r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <details className="evidence-disclosure payment-mapping">
              <summary>Payment details</summary>
              <PaymentTag state={attempt?.status ?? c.courtesy_state} />
              <p className="payment-id">
                {c.capture_id ??
                  "No owned sandbox capture. Complete buyer-approved setup."}
              </p>
              {mode === "SIMULATION" && (
                <small style={{ fontSize: 9, marginTop: 5 }}>
                  SIM_ identifiers are fixture records.
                </small>
              )}
            </details>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            {!attempt && !proposal && (
              <button
                className="primary full"
                disabled={!c.permission.eligible || busy}
                onClick={() =>
                  run(async () => {
                    setProposal(
                      await api<ProposalView>(`cases/${id}/proposal`, {}),
                    );
                  })
                }
              >
                <ShieldCheck size={14} />
                {busy ? "Preparing proposal…" : "Review courtesy refund"}
              </button>
            )}
            {proposal && (
              <ApprovalDialog
                mode={mode}
                proposal={proposal}
                onCancel={() => setProposal(null)}
                onDone={() => {
                  setProposal(null);
                  refresh()
                    .then(() => onUpdated?.())
                    .catch((e) => setError(e.message));
                }}
              />
            )}
            {attempt && (
              <section className="receipt-block" aria-label="Payment result">
                <h3>
                  {attempt.status === "COMPLETED"
                    ? "Courtesy refund completed"
                    : attempt.status === "OUTCOME_UNKNOWN"
                      ? "Outcome unknown: reconciliation required"
                      : "Courtesy action result"}
                </h3>
                <p>
                  {mode === "SIMULATION"
                    ? "Simulated provider result."
                    : attempt.status === "OUTCOME_UNKNOWN"
                      ? "PayPal sandbox outcome is not yet verified."
                      : "Verified PayPal sandbox result."}{" "}
                  Official manufacturer remedy remains outstanding.
                </p>
                <details className="evidence-disclosure">
                  <summary>Refund identifiers & verification</summary>
                  <p className="payment-id">
                    Attempt: {attempt.id}
                    <br />
                    Refund:{" "}
                    {attempt.provider_refund_id ?? "No verified refund ID yet"}
                    <br />
                    Provider state: {attempt.provider_status ?? "Unknown"}
                    {attempt.failure_code && (
                      <>
                        <br />
                        Reason: {attempt.failure_code}
                      </>
                    )}
                  </p>
                </details>
                {attempt.verification_stale && (
                  <p>
                    Provider verification is stale. Last known state preserved.
                  </p>
                )}
                <button
                  className="secondary full"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`attempts/${attempt.id}/reconcile`, {});
                      await refresh();
                    })
                  }
                >
                  <RefreshCw size={12} />
                  Refresh verified status
                </button>
                <button
                  className="secondary full"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api<{ id: string; existing: boolean }>(
                        `approvals/${attempt.approval_id}/execute`,
                        {},
                      );
                      setRepeat(`Existing attempt returned: ${r.id}`);
                      await refresh();
                    })
                  }
                >
                  Re-submit this approval
                </button>
                {repeat && (
                  <div className="success-note" role="status">
                    {repeat}
                  </div>
                )}
                <a
                  className="secondary full"
                  href={`/api/cases/${c.id}/receipt`}
                  download={`${c.display_id}-receipt.json`}
                >
                  <Download size={12} />
                  Download redacted receipt
                </a>
              </section>
            )}
            <details className="evidence-disclosure case-activity">
              <summary>Case activity & audit trail</summary>
              {c.events.length ? (
                <ol className="events-mini">
                  {c.events.slice(-5).map((e, i) => (
                    <li key={i}>
                      {e.event_type.replaceAll("_", " ").toLowerCase()}
                      <small>
                        {new Date(e.created_at).toLocaleTimeString()}
                      </small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="section-description">
                  No financial action recorded for this case.
                </p>
              )}
            </details>
          </div>
        </div>
      </div>
    </aside>
  );
}
