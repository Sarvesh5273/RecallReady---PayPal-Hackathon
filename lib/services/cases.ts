import { pool, one, type DB } from "../db";
import type { Actor } from "../auth/session";
import type {
  ProductRule,
  Policy,
  EvidenceDocument,
  MatchState,
  AttemptState,
  Mode,
} from "../domain/types";
import { eligibility } from "../domain/policy";
import { fingerprint } from "../domain/approvals";
import { matchProduct } from "../domain/matching";
import { notFound } from "../errors";
export type CaseContext = {
  id: string;
  workspace_id: string;
  revision: number;
  order_id: string;
  display_id: string;
  customer_label: string;
  title: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  date_code: string | null;
  customer_note: string | null;
  quantity: number;
  unit_minor: string;
  total_minor: string;
  currency: string;
  tax_minor: string;
  shipping_minor: string;
  discount_minor: string;
  item_count: number;
  scenario: string;
  match_state: MatchState;
  match_reasons: string[];
  official_remedy_state: string;
  courtesy_state: string;
  source_version_id: string;
  source_id: string;
  rule_id: string;
  rule: ProductRule;
  rule_hash: string;
  rule_revision: number;
  rule_active: boolean;
  rule_expires_at: Date;
  policy_id: string;
  policy: Policy;
  policy_hash: string;
  policy_revision: number;
  policy_active: boolean;
  content_hash: string;
  documents: EvidenceDocument[];
  source_date: string;
  fetched_at: Date;
  freshness_checked_at: Date | null;
  freshness_status: string;
  source_origin: string;
  latest_source_id: string;
  canonical_url: string;
  payment_link_id: string | null;
  capture_id: string | null;
  provider_order_id: string | null;
  payment_mode: Mode | null;
  merchant_id: string | null;
  amount_minor: string | null;
  verified_state: string | null;
  owned: boolean | null;
  mode: Mode;
  expected_merchant_id: string;
  workspace_name: string;
  attempt_id: string | null;
  attempt_status: AttemptState | null;
  provider_refund_id: string | null;
  updated_at: Date;
};
const contextSQL = `SELECT c.*,o.id AS order_id,o.display_id,o.customer_label,o.total_minor::text,o.currency,o.tax_minor::text,o.shipping_minor::text,o.discount_minor::text,i.brand,i.model,i.title,i.serial,i.date_code,i.customer_note,i.quantity,i.unit_minor::text,
 (SELECT count(*)::int FROM order_items WHERE order_id=o.id AND workspace_id=c.workspace_id) AS item_count,
 r.rule,r.rule_hash,r.revision AS rule_revision,r.expires_at AS rule_expires_at,(r.revoked_at IS NULL AND r.superseded_at IS NULL AND r.expires_at>now()) AS rule_active,
 p.id AS policy_id,p.policy,p.policy_hash,p.revision AS policy_revision,p.active AS policy_active,
 sv.source_id,sv.content_hash,sv.documents,sv.source_date,sv.fetched_at,sv.freshness_checked_at,sv.freshness_status,sv.origin AS source_origin,rs.canonical_url,
 (SELECT id FROM source_versions WHERE source_id=sv.source_id AND workspace_id=c.workspace_id ORDER BY version DESC LIMIT 1) AS latest_source_id,
 l.id AS payment_link_id,l.capture_id,l.provider_order_id,l.mode AS payment_mode,l.merchant_id,l.amount_minor::text,l.verified_state,l.owned,
 w.mode,w.merchant_id AS expected_merchant_id,w.name AS workspace_name,a.id AS attempt_id,a.status AS attempt_status,a.provider_refund_id
 FROM cases c JOIN order_items i ON i.id=c.order_item_id AND i.workspace_id=c.workspace_id JOIN orders o ON o.id=i.order_id AND o.workspace_id=c.workspace_id
 JOIN reviewed_rules r ON r.id=c.rule_id AND r.workspace_id=c.workspace_id JOIN source_versions sv ON sv.id=c.source_version_id AND sv.workspace_id=c.workspace_id
 JOIN recall_sources rs ON rs.id=sv.source_id AND rs.workspace_id=c.workspace_id JOIN workspaces w ON w.id=c.workspace_id
 LEFT JOIN LATERAL(SELECT * FROM merchant_policies WHERE workspace_id=c.workspace_id ORDER BY active DESC,revision DESC LIMIT 1)p ON true
 LEFT JOIN payment_links l ON l.order_id=o.id AND l.workspace_id=c.workspace_id LEFT JOIN payment_attempts a ON a.capture_id=l.capture_id AND a.workspace_id=c.workspace_id AND a.mode=w.mode`;
export async function loadCase(db: DB, workspaceId: string, caseId: string) {
  const row = await one<CaseContext>(
    db,
    contextSQL + " WHERE c.id=$1 AND c.workspace_id=$2",
    [caseId, workspaceId],
  );
  if (!row) notFound();
  return row;
}
export function casePermission(
  row: CaseContext,
  role: string,
  includeAttempt = true,
) {
  const sourceFresh =
    row.scenario !== "stale" &&
    (row.mode === "SIMULATION" ||
      (row.freshness_status === "CURRENT" &&
        !!row.freshness_checked_at &&
        Date.now() - new Date(row.freshness_checked_at).getTime() <
          Math.min(
            row.policy.requiresFreshSourceHours,
            Number(process.env.SOURCE_MAX_AGE_HOURS ?? 24),
            24,
          ) *
            3600_000));
  return eligibility(
    {
      mode: row.mode,
      role,
      matchState: matchProduct(
        {
          brand: row.brand,
          model: row.model,
          serial: row.serial,
          dateCode: row.date_code,
        },
        row.rule,
      ).state,
      ruleActive:
        row.rule_active && row.latest_source_id === row.source_version_id,
      sourceFresh,
      conflicts: row.rule.unresolvedBlockingConflicts.length,
      policyActive: row.policy_active,
      itemCount: row.item_count,
      quantity: row.quantity,
      taxMinor: row.tax_minor,
      shippingMinor: row.shipping_minor,
      discountMinor: row.discount_minor,
      currency: row.currency,
      orderMinor: row.total_minor,
      captureMinor: row.amount_minor ?? "0",
      owned: !!row.owned && row.payment_mode === row.mode,
      merchantMatches: row.merchant_id === row.expected_merchant_id,
      captureStatus: row.verified_state ?? "NOT_LINKED",
      priorRefund: ["PARTIALLY_REFUNDED", "REFUNDED"].includes(
        row.verified_state ?? "",
      ),
      hasAttempt: includeAttempt && !!row.attempt_id,
    },
    row.policy,
  );
}
export function caseFingerprint(row: CaseContext) {
  return fingerprint({
    workspaceId: row.workspace_id,
    mode: row.mode,
    caseId: row.id,
    caseRevision: row.revision,
    sourceVersionId: row.source_version_id,
    sourceHash: row.content_hash,
    ruleId: row.rule_id,
    ruleHash: row.rule_hash,
    policyId: row.policy_id,
    policyHash: row.policy_hash,
    paymentLinkId: row.payment_link_id,
    captureId: row.capture_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    action: "COURTESY_REFUND_FULL_CAPTURE",
  });
}
export async function listCases(actor: Actor) {
  const rows = (
    await pool.query(
      contextSQL +
        " WHERE c.workspace_id=$1 ORDER BY CASE c.match_state WHEN 'NEEDS_REVIEW' THEN 0 ELSE 1 END,o.display_id",
      [actor.workspaceId],
    )
  ).rows as CaseContext[];
  return rows.map((row) => ({
    ...row,
    permission: casePermission(row, actor.role),
  }));
}
export async function caseDetail(actor: Actor, id: string) {
  const row = await loadCase(pool, actor.workspaceId, id);
  const events = (
    await pool.query(
      "SELECT event_type,details,created_at,correlation_id FROM audit_events WHERE workspace_id=$1 AND (entity_id=$2 OR entity_id=$3) ORDER BY created_at",
      [actor.workspaceId, id, row.attempt_id],
    )
  ).rows;
  return { ...row, permission: casePermission(row, actor.role), events };
}
