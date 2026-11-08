"use client";
import { useMemo } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import { ShieldCheck } from "lucide-react";
import { usd } from "@/lib/domain/money";
export type CaseRow = {
  id: string;
  display_id: string;
  customer_label: string;
  brand: string | null;
  model: string | null;
  match_state: string;
  match_reasons: string[];
  permission: { eligible: boolean; reasons: string[] };
  amount_minor: string | null;
  currency: string;
  courtesy_state: string;
  attempt_status: string | null;
  source_version_id: string;
  scenario: string;
  updated_at: string;
};
export function MatchTag({ state }: { state: string }) {
  const label =
    state === "EXACT_MATCH"
      ? "Confirmed match"
      : state === "NEEDS_REVIEW"
        ? "Needs review"
        : "Not matched";
  return (
    <span
      className={
        "tag " +
        (state === "EXACT_MATCH"
          ? "green"
          : state === "NEEDS_REVIEW"
            ? "amber"
            : "muted")
      }
    >
      {label}
    </span>
  );
}
export function PaymentTag({ state }: { state: string | null }) {
  const labels: Record<string, string> = {
    RESERVED: "Queued",
    PREFLIGHT: "Checking",
    DISPATCHING: "Submitted",
    PROVIDER_PENDING: "Pending at provider",
    COMPLETED: "Courtesy refund completed",
    OUTCOME_UNKNOWN: "Outcome unknown",
    BLOCKED_BEFORE_DISPATCH: "Blocked before dispatch",
    FAILED_FINAL: "Failed",
    CANCELLED_FINAL: "Cancelled",
    HISTORICAL_SIMULATED_REFUND: "Historical simulation",
  };
  return (
    <span
      className={
        "tag " +
        (state === "COMPLETED"
          ? "green"
          : ["OUTCOME_UNKNOWN", "PROVIDER_PENDING"].includes(state ?? "")
            ? "amber"
            : "muted")
      }
    >
      {labels[state ?? ""] ?? "No action"}
    </span>
  );
}
export const reasonText: Record<string, string> = {
  MISSING_BRAND: "Brand identifier is missing.",
  MISSING_MODEL:
    "Model identifier is missing. A product title cannot establish a match.",
  BRAND_EXACT: "Brand matches Belkin.",
  MODEL_EXACT: "Model is exactly PB0003.",
  ALL_SERIALS_EXPLICIT: "Reviewed source includes all PB0003 serial numbers.",
  UNRESOLVED_ALIAS:
    "PB003 appears in the caption; it is not an approved alias for PB0003.",
  MODEL_DIFFERS: "Model differs from the reviewed PB0003 identity.",
  BRAND_DIFFERS: "Brand differs from the recalled manufacturer.",
  UNSUPPORTED_NOTICE_RULE:
    "This model appears in the notice, but its serial rule is not implemented.",
  SOURCE_STALE: "Source review is stale. Review is required before an action.",
  PAYMENT_NOT_OWNED: "Payment has no verified merchant-owned mapping.",
  PAYMENT_STATE_CHANGED:
    "Payment is not a completed, fully refundable capture.",
  UNSUPPORTED_ORDER:
    "Only one item, quantity one, with no tax, shipping, or discount complexity is supported.",
  UNSUPPORTED_CURRENCY: "Only USD courtesy refunds are supported.",
  RULE_UNREVIEWED: "An active source-grounded rule is required.",
  ATTEMPT_EXISTS: "An existing attempt already reserves this capture.",
  UNSUPPORTED_AMOUNT: "Capture amount is outside the merchant policy.",
  POLICY_REVOKED: "Merchant policy is not active.",
};
const theme = themeQuartz.withParams({
  accentColor: "#155846",
  backgroundColor: "#ffffff",
  foregroundColor: "#3e4d40",
  borderColor: "#e3e8e1",
  headerBackgroundColor: "#f8faf5",
  headerTextColor: "#7f8b7a",
  fontFamily: "-apple-system, BlinkMacSystemFont, Arial, sans-serif",
  fontSize: 13,
  headerFontSize: 11,
  rowHeight: 68,
  headerHeight: 44,
  wrapperBorder: false,
  cellHorizontalPadding: 14,
});
export function CaseGrid({
  rows,
  onSelect,
  selected,
  expanded = false,
}: {
  rows: CaseRow[];
  onSelect: (id: string) => void;
  selected: string | null;
  expanded?: boolean;
}) {
  const columns = useMemo<ColDef<CaseRow>[]>(
    () => [
      {
        field: "display_id",
        headerName: "ORDER",
        width: 106,
        pinned: "left",
        cellRenderer: (p: ICellRendererParams<CaseRow>) => (
          <button
            className="grid-case-button"
            onClick={() => onSelect(p.data!.id)}
          >
            {p.value}
          </button>
        ),
      },
      {
        field: "model",
        headerName: "PRODUCT / MODEL",
        minWidth: 130,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<CaseRow>) => (
          <div className="grid-product">
            {p.data?.brand ?? "Unknown brand"}
            <small>{p.value ?? "Model missing"}</small>
          </div>
        ),
      },
      {
        field: "match_state",
        headerName: "MATCH OUTCOME",
        width: 150,
        cellRenderer: (p: ICellRendererParams<CaseRow>) => (
          <MatchTag state={p.value} />
        ),
      },
      {
        headerName: "COURTESY ACTION",
        colId: "eligibility",
        width: 155,
        valueGetter: (p) =>
          p.data?.permission.eligible
            ? "Eligible"
            : (p.data?.permission.reasons[0] ?? ""),
        cellRenderer: (p: ICellRendererParams<CaseRow>) => (
          <span
            className={
              "tag " + (p.data?.permission.eligible ? "green" : "muted")
            }
          >
            {p.data?.permission.eligible
              ? "Eligible for review"
              : p.data?.attempt_status
                ? p.data.attempt_status === "COMPLETED"
                  ? "Refund completed"
                  : "View payment status"
                : "Not eligible"}
          </span>
        ),
      },
      {
        field: "attempt_status",
        hide: !expanded,
        headerName: "PAYMENT STATE",
        width: 150,
        cellRenderer: (p: ICellRendererParams<CaseRow>) => (
          <PaymentTag state={p.value ?? p.data?.courtesy_state} />
        ),
      },
      {
        field: "customer_label",
        headerName: "CUSTOMER",
        width: 150,
        hide: !expanded,
      },
      {
        field: "match_reasons",
        hide: !expanded,
        headerName: "REASONS",
        width: 250,
        valueFormatter: (p) =>
          p.value?.map((v: string) => reasonText[v] ?? v).join(" "),
      },
      {
        field: "amount_minor",
        hide: !expanded,
        headerName: "REFUND AMOUNT",
        valueFormatter: (p) =>
          p.value ? `${usd(p.value)} ${p.data?.currency ?? ""}` : "No capture",
        width: 135,
        comparator: (a, b) =>
          BigInt(a ?? 0) < BigInt(b ?? 0)
            ? -1
            : BigInt(a ?? 0) > BigInt(b ?? 0)
              ? 1
              : 0,
      },
      {
        headerName: "OFFICIAL REMEDY",
        hide: !expanded,
        width: 150,
        valueGetter: () => "External follow-up",
      },
      {
        field: "updated_at",
        hide: !expanded,
        headerName: "LAST UPDATE",
        width: 170,
        valueFormatter: (p) => new Date(p.value).toLocaleString(),
      },
    ],
    [onSelect, expanded],
  );
  return (
    <>
      <div className="grid-wrap">
        <AgGridProvider modules={[AllCommunityModule]}>
          <AgGridReact<CaseRow>
            rowData={rows}
            columnDefs={columns}
            theme={theme}
            defaultColDef={{ sortable: true, filter: true, resizable: true }}
            getRowId={(p) => p.data.id}
            rowSelection={{
              mode: "singleRow",
              checkboxes: false,
              enableClickSelection: true,
            }}
            onRowClicked={(e) => {
              if (e.data) onSelect(e.data.id);
            }}
            rowClassRules={{ "selected-case": (p) => p.data?.id === selected }}
          />
        </AgGridProvider>
      </div>
      <div className="mobile-cases">
        {rows.map((r) => (
          <a className="mobile-case" key={r.id} href={"/cases/" + r.id}>
            <div>
              <strong>{r.display_id}</strong>
              <small>
                {r.brand ?? "Unknown brand"} · {r.model ?? "Model missing"}
              </small>
            </div>
            <MatchTag state={r.match_state} />
          </a>
        ))}
      </div>
      <div className="grid-footer">
        <ShieldCheck size={12} />
        Evidence determines matching. Merchant policy determines payment
        eligibility.
      </div>
    </>
  );
}
