"use client";
import { useState, useEffect, useCallback } from "react";
import { ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  Candidate,
  EvidenceDocument,
  ProductRule,
} from "@/lib/domain/types";
import { api } from "./client-api";
type Source = {
  id: string;
  source_id: string;
  canonical_url: string;
  source_date: string;
  content_hash: string;
  origin: string;
  fetched_at: string;
  freshness_checked_at: string | null;
  freshness_status: string;
  extraction_id: string;
  extraction_model: string;
  extraction_provider: string;
  candidate: Candidate | null;
  extraction_status: string;
  validation_errors: string[];
  rule: ProductRule | null;
  rule_revision: number | null;
  review_note: string | null;
  reviewed_at: string | null;
  review_expires_at: string | null;
  work_pending: boolean;
  extraction_remaining: number;
  extraction_reset_at: string | null;
  recheck_remaining: number;
  recheck_reset_at: string | null;
};
export function SourceReview() {
  const [source, setSource] = useState<
      (Source & { documents: EvidenceDocument[] }) | null
    >(null),
    [mode, setMode] = useState("SIMULATION"),
    [note, setNote] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setSource(await api("sources"));
    const session = await api<{ mode: string }>("session");
    setMode(session.mode);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (!source?.work_pending && source?.extraction_status !== "EXTRACTING")
      return;
    const timer = setInterval(
      () => load().catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(timer);
  }, [load, source?.work_pending, source?.extraction_status]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!source)
    return (
      <div className="loading">{error || "Loading source provenance…"}</div>
    );
  const waitingForQuota =
    source.extraction_status !== "CANDIDATE_READY" &&
    source.extraction_remaining === 0;
  const retryAt =
    source.recheck_remaining === 0
      ? source.recheck_reset_at
      : waitingForQuota
        ? source.extraction_reset_at
        : null;
  const errorLabels: Record<string, string> = {
    AI_EVIDENCE_INVALID:
      "The AI candidate failed evidence validation. Rule promotion is blocked.",
    QUOTE_NOT_FOUND: "A quoted passage did not occur verbatim in the source.",
    AMBIGUOUS_QUOTE:
      "A quote occurs more than once; more source context is required.",
    GEMINI_REQUEST_FAILED:
      "Gemini rejected this request. No validated candidate was produced.",
    GEMINI_RATE_LIMITED:
      "Gemini's request limit was reached. No rule was approved.",
    QUOTA_EXCEEDED: "This workspace's extraction limit was reached.",
  };
  const extractionLabels: Record<string, string> = {
    CANDIDATE_READY: "Ready for your review",
    EXTRACTION_FAILED: "Needs attention",
    EXTRACTING: "Reading the notice…",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STEP 1 · REVIEW THE NOTICE</p>
          <h1>Start with the facts.</h1>
          <p>
            Check what the notice says. Confirm the exact model before using it
            for order review.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={13} />
          Refresh view
        </button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="success-note">
          {message}
        </div>
      )}
      <div className="source-layout">
        <div className="stack">
          <section className="panel padded">
            <p className="eyebrow">OFFICIAL SOURCE SNAPSHOT</p>
            <h2>CPSC recall 26-090</h2>
            <p className="section-description">
              Belkin portable power banks and wireless charging stands
              <br />
              Displayed notice date: {source.source_date}
              <br />
              Retrieved: {new Date(source.fetched_at).toLocaleString()}
              <br />
              Origin: {source.origin}
              <br />
              Freshness:{" "}
              {source.freshness_checked_at
                ? new Date(source.freshness_checked_at).toLocaleString()
                : "Cached fixture; no live freshness check"}
            </p>
            <a
              className="notice-link"
              style={{ marginTop: 12 }}
              href={source.canonical_url}
              target="_blank"
              rel="noreferrer"
            >
              Open official CPSC notice <ArrowUpRight size={12} />
            </a>
            <details style={{ marginTop: 15 }}>
              <summary className="hash">Snapshot SHA-256</summary>
              <p className="hash">{source.content_hash}</p>
            </details>
            <details className="source-snapshot-disclosure">
              <summary>Read the full saved notice</summary>
              <div className="source-body">
                {source.documents.find((d) => d.id === "notice")?.text}
              </div>
            </details>
          </section>
          <section className="panel padded">
            <p className="eyebrow">HUMAN REVIEW</p>
            <h2>
              {source.review_note
                ? "Reviewed: Belkin PB0003"
                : "Confirm the exact PB0003 rule"}
            </h2>
            <p className="section-description">
              PB003 remains a separate, ambiguous identity. MMA008 and BPB002
              serial conditions remain outside the supported rule.
            </p>
            {source.review_note && (
              <details className="evidence-disclosure">
                <summary>
                  Your saved review · Rule r{source.rule_revision}
                </summary>
                <blockquote className="source-quote">
                  {source.review_note}
                  <small>
                    RULE r{source.rule_revision} ·{" "}
                    {source.reviewed_at &&
                      new Date(source.reviewed_at).toLocaleString()}
                  </small>
                </blockquote>
              </details>
            )}
            {source.review_note && (
              <a className="primary full" href="/workbench">
                Continue to order review <ArrowUpRight size={15} />
              </a>
            )}
            <details
              className="rule-editor"
              open={source.review_note ? undefined : true}
            >
              <summary>
                {source.review_note
                  ? "Review this rule again"
                  : "Record your review"}
              </summary>
              <label htmlFor="review-note" className="field-label">
                Resolve the caption/body discrepancy
              </label>
              <textarea
                id="review-note"
                className="text-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Record why the description supports exact PB0003, why all serials apply to this model, and why PB003 is not an alias."
                rows={4}
                maxLength={2000}
              />
              <label
                className="field-label"
                style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I reviewed the source context and approve only this exact PB0003
                scope.
              </label>
              <button
                className="primary full"
                disabled={
                  busy ||
                  !checked ||
                  source.work_pending ||
                  note.length < 40 ||
                  source.extraction_status !== "CANDIDATE_READY"
                }
                onClick={() =>
                  act(async () => {
                    await api("rules/review", {
                      sourceVersionId: source.id,
                      extractionId: source.extraction_id,
                      conflictNote: note,
                      confirmation: true,
                    });
                    setMessage(
                      "New immutable rule promoted. Pending approvals require review again.",
                    );
                    setChecked(false);
                    await load();
                  })
                }
              >
                <ShieldCheck size={13} />
                {source.review_note
                  ? "Save a new reviewed rule"
                  : "Approve reviewed rule"}
              </button>
            </details>
          </section>
        </div>
        <section className="panel padded">
          <p className="eyebrow">EXTRACTION CANDIDATE</p>
          <h2>
            {source.extraction_status === "CANDIDATE_READY"
              ? "Supported product facts"
              : "Candidate needs attention"}
          </h2>
          <p className="section-description">
            <span
              className={
                "tag " +
                (source.extraction_status === "CANDIDATE_READY"
                  ? "green"
                  : "amber")
              }
            >
              {extractionLabels[source.extraction_status] ??
                "Waiting for the worker"}
            </span>
          </p>
          <details className="evidence-disclosure">
            <summary>AI extraction details</summary>
            <p className="section-description">
              {source.extraction_model === "FIXTURE_NO_MODEL_CALL"
                ? "Fixture extraction replay. No model request was made."
                : `Provider: ${source.extraction_provider ?? "Unknown"} · Model: ${source.extraction_model ?? "Not configured"}`}
              <br />
              State: {source.extraction_status ?? "Queued"}
            </p>
          </details>
          {source.candidate &&
            source.extraction_status !== "CANDIDATE_READY" && (
              <p className="error-box">
                Rejected AI output is shown for inspection. These facts cannot
                be promoted into a rule.
              </p>
            )}
          {source.candidate?.products.map((p, i) => (
            <div key={i} className="match-box">
              <strong>
                {p.brand.value ?? "Unknown brand"} ·{" "}
                {p.model.value ?? "Unknown model"}
              </strong>
              <p>
                {p.serialScope === "ALL_EXPLICIT"
                  ? "All serial numbers included"
                  : p.serialScope === "CONSTRAINED"
                    ? "Only specified serial numbers included"
                    : "Serial range is unknown"}
                <br />
                Date constraints:{" "}
                {p.dateCodeConditions.length
                  ? "Review required"
                  : "None stated in this candidate"}
              </p>
              {p.serialConditions.map((f, j) => (
                <blockquote className="source-quote" key={j}>
                  {f.evidence[0]?.quote}
                </blockquote>
              ))}
            </div>
          ))}
          {source.candidate?.conflicts.map((c, i) => (
            <div key={i} className="match-box amber">
              <strong>Source conflict · {c.field}</strong>
              <p>{c.description}</p>
              {c.evidence.map((e, j) => (
                <blockquote className="source-quote" key={j}>
                  {e.quote}
                </blockquote>
              ))}
            </div>
          ))}
          {source.validation_errors?.map((e, i) => (
            <p key={i} className="error-box">
              {errorLabels[e] ?? e}
            </p>
          ))}
          {source.work_pending && (
            <p role="status" className="section-description">
              The worker is checking the source or extracting its facts. This
              view refreshes automatically.
            </p>
          )}
          {retryAt && (
            <p role="status" className="match-box amber">
              Request limit reached. Retry after{" "}
              {new Date(retryAt).toLocaleString()}. The source and any rejected
              output are preserved.
            </p>
          )}
          {mode === "PAYPAL_SANDBOX" && (
            <button
              className="secondary full"
              disabled={busy || source.work_pending || !!retryAt}
              onClick={() =>
                act(async () => {
                  await api(`sources/${source.source_id}/recheck`, {});
                  setMessage(
                    "Official source recheck queued. Refresh after the worker processes it.",
                  );
                  setChecked(false);
                  await load();
                })
              }
            >
              <RefreshCw size={13} />
              Recheck official source
            </button>
          )}
        </section>
      </div>
    </>
  );
}
