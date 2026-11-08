import { randomUUID } from "node:crypto";
import { transaction, one, type DB } from "../db";
import {
  loadCase,
  casePermission,
  caseFingerprint,
  type CaseContext,
} from "./cases";
import { audit } from "../observability/audit";
import { BusinessError, notFound } from "../errors";
import type { Actor } from "../auth/session";
import type { AttemptState, Mode } from "../domain/types";
export type Proposal = {
  id: string;
  workspace_id: string;
  case_id: string;
  payment_link_id: string;
  amount_minor: string;
  currency: string;
  canonical: string;
  fingerprint: string;
  expires_at: Date;
};
export type Approval = {
  id: string;
  workspace_id: string;
  proposal_id: string;
  approver_id: string;
  approved_fingerprint: string;
  expires_at: Date;
  revoked_at: Date | null;
};
export type Attempt = {
  id: string;
  workspace_id: string;
  approval_id: string;
  case_id: string;
  capture_id: string;
  mode: Mode;
  amount_minor: string;
  currency: "USD";
  paypal_request_id: string;
  status: AttemptState;
  dispatch_started_at: Date | null;
  provider_refund_id: string | null;
  provider_status: string | null;
  failure_code: string | null;
  provider_snapshot: unknown;
  verification_stale: boolean;
  correlation_id: string;
  created_at: Date;
  updated_at: Date;
};
export async function lockWorkspace(db: DB, workspaceId: string) {
  if (
    !(await one(db, "SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspaceId,
    ]))
  )
    notFound();
}
function requireEligible(
  row: CaseContext,
  role: string,
  includeAttempt = true,
) {
  const decision = casePermission(row, role, includeAttempt);
  if (!decision.eligible)
    throw new BusinessError(
      decision.reasons[0],
      "This case is not eligible: " + decision.reasons.join(", "),
      422,
    );
}
export async function createProposal(actor: Actor, caseId: string) {
  return transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    const row = await loadCase(db, actor.workspaceId, caseId);
    requireEligible(row, actor.role);
    const fp = caseFingerprint(row),
      id = randomUUID();
    const expires = new Date(
      Date.now() +
        Math.min(
          row.policy.approvalTtlMinutes,
          Number(process.env.APPROVAL_TTL_MINUTES ?? 10),
          10,
        ) *
          60_000,
    );
    await db.query(
      "INSERT INTO refund_proposals(id,workspace_id,case_id,case_revision,payment_link_id,source_version_id,rule_id,policy_id,amount_minor,currency,canonical,fingerprint,eligibility_reasons,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        id,
        actor.workspaceId,
        row.id,
        row.revision,
        row.payment_link_id,
        row.source_version_id,
        row.rule_id,
        row.policy_id,
        row.amount_minor,
        row.currency,
        fp.canonical,
        fp.hash,
        JSON.stringify([]),
        expires,
      ],
    );
    await db.query(
      "UPDATE cases SET courtesy_state='PROPOSED',updated_at=now() WHERE id=$1 AND workspace_id=$2",
      [caseId, actor.workspaceId],
    );
    await audit(
      db,
      actor.workspaceId,
      "PROPOSAL_CREATED",
      caseId,
      {
        proposalId: id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        fingerprint: fp.hash,
      },
      actor.userId,
    );
    return {
      id,
      fingerprint: fp.hash,
      expires_at: expires,
      amount_minor: row.amount_minor,
      currency: row.currency,
      capture_id: row.capture_id,
      provider_order_id: row.provider_order_id,
      merchant: row.workspace_name,
      canonical: fp.canonical,
      rule_revision: row.rule_revision,
      policy_revision: row.policy_revision,
    };
  });
}
export async function validateApproval(
  db: DB,
  workspaceId: string,
  approvalId: string,
) {
  const approval = await one<Approval>(
    db,
    "SELECT * FROM approvals WHERE id=$1 AND workspace_id=$2",
    [approvalId, workspaceId],
  );
  if (!approval) notFound();
  const proposal = await one<Proposal>(
    db,
    "SELECT * FROM refund_proposals WHERE id=$1 AND workspace_id=$2",
    [approval.proposal_id, workspaceId],
  );
  if (!proposal) notFound();
  const row = await loadCase(db, workspaceId, proposal.case_id);
  const membership = await one<{ role: string }>(
    db,
    "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
    [workspaceId, approval.approver_id],
  );
  if (approval.revoked_at)
    throw new BusinessError("APPROVAL_REVOKED", "Approval was revoked.");
  if (
    new Date(approval.expires_at).getTime() <= Date.now() ||
    new Date(proposal.expires_at).getTime() <= Date.now()
  )
    throw new BusinessError("APPROVAL_EXPIRED", "Review a new proposal.");
  const fp = caseFingerprint(row);
  if (
    approval.approved_fingerprint !== proposal.fingerprint ||
    fp.hash !== proposal.fingerprint ||
    fp.canonical !== proposal.canonical
  )
    throw new BusinessError(
      "APPROVAL_STALE",
      "The source or decision changed. Review a new proposal.",
    );
  requireEligible(row, membership?.role ?? "", false);
  return { approval, proposal, row };
}
export async function approve(
  actor: Actor,
  proposalId: string,
  input: { proposalFingerprint: string; confirmation: true; note?: string },
) {
  return transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    const proposal = await one<Proposal>(
      db,
      "SELECT * FROM refund_proposals WHERE id=$1 AND workspace_id=$2",
      [proposalId, actor.workspaceId],
    );
    if (!proposal) notFound();
    const row = await loadCase(db, actor.workspaceId, proposal.case_id);
    requireEligible(row, actor.role);
    if (new Date(proposal.expires_at).getTime() <= Date.now())
      throw new BusinessError("APPROVAL_EXPIRED", "This proposal expired.");
    if (
      input.proposalFingerprint !== proposal.fingerprint ||
      caseFingerprint(row).hash !== proposal.fingerprint
    )
      throw new BusinessError(
        "APPROVAL_STALE",
        "The source or decision changed.",
      );
    const existing = await one<Approval>(
      db,
      "SELECT * FROM approvals WHERE proposal_id=$1 AND workspace_id=$2",
      [proposalId, actor.workspaceId],
    );
    if (existing) return existing;
    const id = randomUUID();
    await db.query(
      "INSERT INTO approvals(id,workspace_id,proposal_id,approver_id,approved_fingerprint,note,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        actor.workspaceId,
        proposalId,
        actor.userId,
        proposal.fingerprint,
        input.note ?? "",
        proposal.expires_at,
      ],
    );
    await db.query(
      "UPDATE cases SET courtesy_state='APPROVED',updated_at=now() WHERE id=$1 AND workspace_id=$2",
      [row.id, actor.workspaceId],
    );
    await audit(
      db,
      actor.workspaceId,
      "APPROVAL_RECORDED",
      row.id,
      { approvalId: id, fingerprint: proposal.fingerprint },
      actor.userId,
    );
    return { id };
  });
}
export async function reserve(actor: Actor, approvalId: string) {
  return transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    const bound = await one<{ capture_id: string }>(
      db,
      "SELECT l.capture_id FROM approvals a JOIN refund_proposals p ON p.id=a.proposal_id AND p.workspace_id=a.workspace_id JOIN payment_links l ON l.id=p.payment_link_id AND l.workspace_id=a.workspace_id WHERE a.id=$1 AND a.workspace_id=$2",
      [approvalId, actor.workspaceId],
    );
    if (!bound) notFound();
    const existing = await one<Attempt>(
      db,
      "SELECT * FROM payment_attempts WHERE workspace_id=$1 AND mode=$2 AND capture_id=$3",
      [actor.workspaceId, actor.mode, bound.capture_id],
    );
    if (existing) {
      await audit(
        db,
        actor.workspaceId,
        "EXISTING_ATTEMPT_RETURNED",
        existing.id,
        { attemptId: existing.id },
        actor.userId,
      );
      return { ...existing, existing: true };
    }
    const { row } = await validateApproval(db, actor.workspaceId, approvalId);
    const id = randomUUID(),
      correlationId = randomUUID();
    const attempt = await one<Attempt>(
      db,
      `INSERT INTO payment_attempts(id,workspace_id,approval_id,case_id,capture_id,mode,amount_minor,currency,paypal_request_id,status,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESERVED',$10) RETURNING *`,
      [
        id,
        actor.workspaceId,
        approvalId,
        row.id,
        row.capture_id,
        row.mode,
        row.amount_minor,
        row.currency,
        randomUUID(),
        correlationId,
      ],
    );
    await enqueue(db, actor.workspaceId, "EXECUTE_REFUND", { attemptId: id });
    await db.query(
      "UPDATE cases SET courtesy_state='RESERVED',updated_at=now() WHERE id=$1 AND workspace_id=$2",
      [row.id, actor.workspaceId],
    );
    await audit(
      db,
      actor.workspaceId,
      "ATTEMPT_RESERVED",
      id,
      {
        caseId: row.id,
        approvalId,
        amountMinor: row.amount_minor,
        currency: row.currency,
        mode: row.mode,
      },
      actor.userId,
      correlationId,
    );
    return { ...attempt!, existing: false };
  });
}
export async function enqueue(
  db: DB,
  workspaceId: string,
  kind: string,
  payload: Record<string, unknown>,
  delay = 0,
) {
  await db.query(
    "INSERT INTO jobs(id,workspace_id,kind,payload,run_after) VALUES($1,$2,$3,$4,now()+$5*interval '1 second')",
    [randomUUID(), workspaceId, kind, JSON.stringify(payload), delay],
  );
}
export async function attemptState(
  db: DB,
  attempt: Attempt,
  status: AttemptState,
  extra: {
    refundId?: string;
    providerStatus?: string;
    failureCode?: string;
    snapshot?: unknown;
  } = {},
) {
  await db.query(
    "UPDATE payment_attempts SET status=$1,provider_refund_id=COALESCE($2,provider_refund_id),provider_status=COALESCE($3,provider_status),failure_code=$4,provider_snapshot=COALESCE($5,provider_snapshot),updated_at=now() WHERE id=$6 AND workspace_id=$7",
    [
      status,
      extra.refundId ?? null,
      extra.providerStatus ?? null,
      extra.failureCode ?? null,
      extra.snapshot ? JSON.stringify(extra.snapshot) : null,
      attempt.id,
      attempt.workspace_id,
    ],
  );
  await db.query(
    "UPDATE cases SET courtesy_state=$1,updated_at=now() WHERE id=$2 AND workspace_id=$3",
    [status, attempt.case_id, attempt.workspace_id],
  );
  await audit(
    db,
    attempt.workspace_id,
    "ATTEMPT_" + status,
    attempt.id,
    {
      caseId: attempt.case_id,
      status,
      amountMinor: attempt.amount_minor,
      currency: attempt.currency,
      ...(extra.failureCode ? { failureCode: extra.failureCode } : {}),
    },
    "worker",
    attempt.correlation_id,
  );
}
