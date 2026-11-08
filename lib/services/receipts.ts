import { caseDetail } from "./cases";
import { pool, one } from "../db";
import type { Actor } from "../auth/session";
import type { Attempt } from "./execution";
export async function receipt(actor: Actor, id: string) {
  const c = await caseDetail(actor, id);
  const a = c.attempt_id
    ? await one<Attempt>(
        pool,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2",
        [c.attempt_id, actor.workspaceId],
      )
    : undefined;
  const approval = a
    ? await one<{
        canonical: string;
        fingerprint: string;
        approver_id: string;
        approved_at: Date;
        note: string;
      }>(
        pool,
        "SELECT p.canonical,p.fingerprint,a.approver_id,a.approved_at,a.note FROM approvals a JOIN refund_proposals p ON p.id=a.proposal_id AND p.workspace_id=a.workspace_id WHERE a.id=$1 AND a.workspace_id=$2",
        [a.approval_id, actor.workspaceId],
      )
    : undefined;
  return {
    mode: actor.mode,
    merchant: c.workspace_name,
    order: c.display_id,
    customer: c.customer_label,
    product: { brand: c.brand, model: c.model },
    match: { state: c.match_state, reasons: c.match_reasons },
    officialRemedy: {
      state: c.official_remedy_state,
      manufacturerClaimSubmitted: false,
      sourceUrl: c.canonical_url,
    },
    source: {
      versionId: c.source_version_id,
      hash: c.content_hash,
      ruleId: c.rule_id,
      ruleHash: c.rule_hash,
    },
    courtesyAction: a
      ? {
          attemptId: a.id,
          approvalId: a.approval_id,
          amountMinor: a.amount_minor,
          currency: a.currency,
          status: a.status,
          captureId: a.capture_id,
          providerRefundId: a.provider_refund_id,
          providerStatus: a.provider_status,
          requestId: a.paypal_request_id,
          verificationStale: a.verification_stale,
          recordedAt: a.updated_at,
          approvedBasis: approval ? JSON.parse(approval.canonical) : null,
          approvedFingerprint: approval?.fingerprint ?? null,
          approvedAt: approval?.approved_at ?? null,
          approverId: approval?.approver_id ?? null,
          operatorNote: approval?.note ?? null,
        }
      : null,
    events: c.events,
  };
}
