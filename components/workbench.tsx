"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  ArrowUpRight,
  CheckCircle2,
  ScanSearch,
  SlidersHorizontal,
  ShieldCheck,
  BookOpen,
  Search,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { CaseGrid, type CaseRow } from "./case-grid";
import { EvidencePanel } from "./evidence-panel";
import { api } from "./client-api";
type Source = {
  source_id: string;
  canonical_url: string;
  source_date: string;
  fetched_at: string;
  origin: string;
  rule_revision: number;
  freshness_status: string;
  extraction_model: string;
};
export function Workbench() {
  const router = useRouter();
  const [rows, setRows] = useState<CaseRow[]>([]),
    [source, setSource] = useState<Source | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [filter, setFilter] = useState("ALL"),
    [payment, setPayment] = useState("ALL"),
    [missing, setMissing] = useState("ALL"),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [advanced, setAdvanced] = useState(false),
    [error, setError] = useState(""),
    [tour, setTour] = useState(false),
    [step, setStep] = useState("RR-001");
  const refresh = useCallback(async () => {
    setRows(await api<CaseRow[]>("cases"));
  }, []);
  useEffect(() => {
    Promise.all([api<CaseRow[]>("cases"), api<Source>("sources")])
      .then(([cases, src]) => {
        setRows(cases);
        setSource(src);
        setSelected(
          cases.find((c) => c.display_id === "RR-001")?.id ??
            cases[0]?.id ??
            null,
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const select = useCallback(
    (id: string) => {
      if (window.innerWidth <= 900) router.push("/cases/" + id);
      else setSelected(id);
    },
    [router],
  );
  const visible = rows.filter(
    (c) =>
      (filter === "ALL" || c.match_state === filter) &&
      (payment === "ALL" ||
        (payment === "ELIGIBLE"
          ? c.permission.eligible
          : c.attempt_status === payment)) &&
      (missing === "ALL" || c.match_reasons.includes(missing)) &&
      [c.display_id, c.brand, c.model, c.customer_label]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const needsRule =
    !source?.rule_revision ||
    (rows.length > 0 &&
      rows.every((c) => c.permission.reasons.includes("RULE_UNREVIEWED")));
  const ready = rows.filter((c) => c.permission.eligible);
  const unknown = rows.find((c) => c.attempt_status === "OUTCOME_UNKNOWN");
  const completed = rows.find((c) => c.attempt_status === "COMPLETED");
  const counts = [
    {
      label: "Confirmed matches",
      value: rows.filter((c) => c.match_state === "EXACT_MATCH").length,
      note: "Exact reviewed model identity",
      className: "green",
      icon: CheckCircle2,
    },
    {
      label: "Needs review",
      value: rows.filter((c) => c.match_state === "NEEDS_REVIEW").length,
      note: "Missing or ambiguous evidence",
      className: "amber",
      icon: ScanSearch,
    },
    {
      label: "Not matched to notice",
      value: rows.filter((c) => c.match_state === "NOT_MATCHED_TO_NOTICE")
        .length,
      note: "Outside this reviewed rule",
      className: "",
      icon: SlidersHorizontal,
    },
    {
      label: "Courtesy refunds completed",
      value: rows.filter((c) => c.attempt_status === "COMPLETED").length,
      note: rows.some((c) => c.attempt_status === "COMPLETED")
        ? "Official remedy still outstanding"
        : "No financial actions completed",
      className: "green",
      icon: ShieldCheck,
    },
  ];
  if (loading)
    return (
      <div className="workbench-loading" role="status">
        <p className="eyebrow">YOUR RECALL WORKBENCH</p>
        <h1>Opening your workbench…</h1>
        <p>Loading the notice, your orders, and their saved status.</p>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR RECALL WORKBENCH</p>
          <h1>Know what needs attention.</h1>
          <p>
            Review the evidence. Find the right orders. Decide the next step.
          </p>
        </div>
        <button className="secondary" onClick={() => setTour((v) => !v)}>
          <BookOpen size={13} />
          {tour ? "Close walkthrough" : "Guided walkthrough"}
        </button>
      </div>
      <div className="workflow-progress" aria-label="Recall workflow">
        <Link href="/sources" className={needsRule ? "current" : "done"}>
          <span>{needsRule ? "1" : <CheckCircle2 size={16} />}</span>
          <div>
            <strong>Review notice</strong>
            <small>
              {needsRule
                ? "Check the source & model rule"
                : "Reviewed rule ready"}
            </small>
          </div>
        </Link>
        <div className={!needsRule ? "current" : ""}>
          <span>2</span>
          <div>
            <strong>Inspect orders</strong>
            <small>Exact matches & missing evidence</small>
          </div>
        </div>
        <div className={completed ? "done" : ""}>
          <span>{completed ? <CheckCircle2 size={16} /> : "3"}</span>
          <div>
            <strong>Approve & track</strong>
            <small>
              {completed ? "Refund proof saved" : "Your policy. Your approval."}
            </small>
          </div>
        </div>
      </div>
      {tour && (
        <div className="tour">
          <div>
            <strong>
              {step === "RR-001"
                ? "1. An exact model, a separate refund decision"
                : step === "RR-002"
                  ? "2. A similar product can have a different model"
                  : step === "RR-003"
                    ? "3. Missing evidence stays uncertain"
                    : "4. An uncertain outcome cannot be retried"}
            </strong>
            <p>
              {step === "RR-001"
                ? "Review PB0003, then inspect the merchant policy before approving."
                : step === "RR-002"
                  ? "PB0004 is not matched to this notice. This is not a product safety certification."
                  : step === "RR-003"
                    ? "A listing title is insufficient. No enabled financial path."
                    : "Simulate a timeout. Refresh only reconciles provider reads."}
            </p>
          </div>
          <div className="tour-buttons">
            {["RR-001", "RR-002", "RR-003", "RR-021"].map((n, i) => (
              <button
                className={step === n ? "active" : ""}
                key={n}
                onClick={() => {
                  setStep(n);
                  const r = rows.find((c) => c.display_id === n);
                  if (r) select(r.id);
                }}
              >
                {i + 1}. {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <section className="notice-strip" aria-label="Official notice context">
        <div className="notice-info">
          <span className="notice-icon">
            <FileText size={19} />
          </span>
          <div>
            <strong>Belkin product recall</strong>
            <small>
              CPSC 26-090 · Notice dated {source?.source_date ?? "2025-11-13"} ·
              Rule{" "}
              {source?.rule_revision
                ? `r${source.rule_revision}`
                : "awaiting review"}{" "}
              ·{" "}
              {source?.origin === "CPSC_LIVE"
                ? "Live official snapshot"
                : "Cached official source fixture"}
            </small>
          </div>
        </div>
        <a
          className="notice-link"
          href={source ? "/sources/" + source.source_id : "/sources"}
        >
          View source & rule <ArrowUpRight size={12} />
        </a>
      </section>
      {rows.length > 0 && (
        <section className="next-action" aria-label="Next recommended step">
          <span className="next-action-icon">
            <ShieldCheck size={22} />
          </span>
          <div>
            <p className="eyebrow">NEXT STEP</p>
            <strong>
              {needsRule
                ? "Review the source before a refund"
                : unknown
                  ? "Check an uncertain payment outcome"
                  : ready.length
                    ? `${ready.length} ${ready.length === 1 ? "order is" : "orders are"} ready for refund review`
                    : completed
                      ? "Your refund is complete. The receipt is ready."
                      : "Investigate the orders that need more evidence"}
            </strong>
            <p>
              {needsRule
                ? "Approve the exact model scope from the official notice."
                : unknown
                  ? "Refresh its verified status before any further action."
                  : ready.length
                    ? "Check the merchant basis and exact amount before approving."
                    : completed
                      ? "Manufacturer follow-up remains a separate step."
                      : "A missing model or ambiguous identifier stays in review."}
            </p>
          </div>
          {needsRule ? (
            <Link className="primary" href="/sources">
              Review notice
              <ArrowRight size={16} />
            </Link>
          ) : (
            <button
              className="primary"
              onClick={() => {
                const target =
                  unknown ??
                  ready[0] ??
                  completed ??
                  rows.find((c) => c.match_state === "NEEDS_REVIEW");
                if (target) {
                  select(target.id);
                  if (window.innerWidth > 900)
                    document
                      .querySelector(".workbench")
                      ?.scrollIntoView({ block: "start", behavior: "smooth" });
                }
              }}
            >
              {unknown
                ? "Check status"
                : ready.length
                  ? "Review order"
                  : completed
                    ? "View receipt"
                    : "Inspect order"}
              <ArrowRight size={16} />
            </button>
          )}
        </section>
      )}
      <div className="metrics">
        {counts.map((c) => (
          <div className={"metric " + c.className} key={c.label}>
            <div className="metric-top">
              {c.label}
              <c.icon />
            </div>
            <div className="metric-value">{c.value}</div>
            <small>{c.note}</small>
          </div>
        ))}
      </div>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      <div className="workbench">
        <section className="case-section">
          <header className="section-head">
            <h2>Your orders</h2>
            <span className="count-pill">{visible.length}</span>
            <small>
              {rows.filter((c) => c.permission.eligible).length} eligible for
              review
            </small>
          </header>
          <div className="order-search">
            <Search size={17} />
            <input
              aria-label="Search orders"
              placeholder="Search order, brand or model…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className={"secondary " + (advanced ? "selected" : "")}
              aria-expanded={advanced}
              onClick={() => setAdvanced((v) => !v)}
            >
              <SlidersHorizontal size={15} />
              More filters
            </button>
          </div>
          <div className="filters">
            {[
              ["ALL", "All cases"],
              ["EXACT_MATCH", "Confirmed"],
              ["NEEDS_REVIEW", "Needs review"],
              ["NOT_MATCHED_TO_NOTICE", "Not matched"],
            ].map(([value, label]) => (
              <button
                className={"filter " + (filter === value ? "active" : "")}
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
            {advanced && (
              <select
                className="filter-select"
                aria-label="Filter payment state"
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                <option value="ALL">Payment: all</option>
                <option value="ELIGIBLE">Eligible</option>
                <option value="COMPLETED">Completed</option>
                <option value="OUTCOME_UNKNOWN">Outcome unknown</option>
                <option value="PROVIDER_PENDING">Provider pending</option>
              </select>
            )}
            {advanced && (
              <select
                className="filter-select"
                aria-label="Filter missing evidence"
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
              >
                <option value="ALL">Evidence: all</option>
                <option value="MISSING_MODEL">Missing model</option>
                <option value="MISSING_BRAND">Missing brand</option>
                <option value="UNRESOLVED_ALIAS">Ambiguous alias</option>
              </select>
            )}
          </div>
          {visible.length ? (
            <CaseGrid
              rows={visible}
              onSelect={select}
              selected={selected}
              expanded={advanced}
            />
          ) : (
            <div className="empty-orders">
              <ScanSearch size={28} />
              <h3>No orders match these filters.</h3>
              <p>Try another model or clear your filters to see all orders.</p>
              <button
                className="secondary"
                onClick={() => {
                  setSearch("");
                  setFilter("ALL");
                  setMissing("ALL");
                  setPayment("ALL");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </section>
        {selected && (
          <EvidencePanel key={selected} id={selected} onUpdated={refresh} />
        )}
      </div>
    </>
  );
}
