import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, transaction, one } from "../../lib/db";
import { migrate } from "../../scripts/migrate";
import { seedWorkspace } from "../../lib/services/seed";
import {
  createProposal,
  approve,
  reserve,
  type Attempt,
} from "../../lib/services/execution";
import { listCases, loadCase, casePermission } from "../../lib/services/cases";
import {
  executeRefund,
  recoverDispatches,
  reconcileRefund,
} from "../../worker/handlers/refund";
import { FixturePaymentAdapter } from "../../lib/adapters/fixture-payment";
import type { Actor } from "../../lib/auth/session";
import { ledger } from "../../lib/adapters/fixtures";
let actor: Actor;
async function workspace() {
  const userId = randomUUID();
  return transaction(async (db) => {
    await db.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
      [userId, userId + "@example.test", "unusable"],
    );
    const w = await seedWorkspace(db, userId);
    return {
      userId,
      workspaceId: w.workspaceId,
      sessionId: randomUUID(),
      role: "OPERATOR",
      mode: "SIMULATION",
      merchantId: "SIM_MERCHANT_" + w.workspaceId,
      workspaceName: "Harbor Demo Goods",
      csrfHash: "test",
    } as Actor;
  });
}
async function caseFor(a: Actor, displayId = "RR-001") {
  const rows = await listCases(a);
  return rows.find((x) => x.display_id === displayId)!;
}
async function approved(a: Actor, displayId = "RR-001") {
  const row = await caseFor(a, displayId),
    proposal = await createProposal(a, row.id),
    approval = await approve(a, proposal.id, {
      proposalFingerprint: proposal.fingerprint,
      confirmation: true,
    });
  return { row, proposal, approval };
}
beforeAll(async () => {
  await migrate();
  actor = await workspace();
});
afterAll(() => pool.end());
describe("PostgreSQL payment invariants", () => {
  it.each(["RR-018", "RR-019"])(
    "simulation %s exposes the post-approval failure without dispatch",
    async (displayId) => {
      const a = await workspace();
      const { approval } = await approved(a, displayId);
      const attempt = await reserve(a, approval.id);
      await executeRefund(a.workspaceId, attempt.id);
      expect(
        (await one<Attempt>(
          pool,
          "SELECT * FROM payment_attempts WHERE id=$1",
          [attempt.id],
        ))!.status,
      ).toBe("BLOCKED_BEFORE_DISPATCH");
      expect(
        (
          await pool.query(
            "SELECT * FROM fixture_provider_events WHERE attempt_id=$1",
            [attempt.id],
          )
        ).rowCount,
      ).toBe(0);
    },
  );
  it("24 fixtures classify; product outcome and permission are separate", async () => {
    const rows = await listCases(actor);
    expect(rows).toHaveLength(24);
    for (const fixture of ledger) {
      const row = rows.find((r) => r.display_id === fixture.id)!;
      expect(row.match_state).toBe(fixture.expectedMatch);
      if (fixture.expectedPolicy === "ELIGIBLE")
        expect(row.permission.eligible).toBe(true);
      else expect(row.permission.reasons).toContain(fixture.expectedPolicy);
    }
  });
  it("I-01 concurrent requests reserve exactly one attempt/job", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    const attempts = await Promise.all([
      reserve(a, approval.id),
      reserve(a, approval.id),
      reserve(a, approval.id),
    ]);
    expect(new Set(attempts.map((x) => x.id)).size).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT * FROM jobs WHERE workspace_id=$1 AND kind='EXECUTE_REFUND'",
          [a.workspaceId],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("I-02 duplicate jobs/workers send one provider write and preserve official remedy", async () => {
    const a = await workspace();
    const { approval, row } = await approved(a);
    const attempt = await reserve(a, approval.id);
    await Promise.all([
      executeRefund(a.workspaceId, attempt.id),
      executeRefund(a.workspaceId, attempt.id),
    ]);
    await executeRefund(a.workspaceId, attempt.id);
    const saved = await one<Attempt>(
      pool,
      "SELECT * FROM payment_attempts WHERE id=$1",
      [attempt.id],
    );
    expect(saved!.status).toBe("COMPLETED");
    expect(
      (
        await pool.query(
          "SELECT * FROM fixture_provider_events WHERE attempt_id=$1 AND operation='REFUND_POST'",
          [attempt.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (await loadCase(pool, a.workspaceId, row.id)).official_remedy_state,
    ).toBe("EXTERNAL_FOLLOWUP_REQUIRED");
    expect((await reserve(a, approval.id)).id).toBe(attempt.id);
  });
  it("I-03 crashed dispatch becomes unknown and is never resent", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    const attempt = await reserve(a, approval.id);
    await pool.query(
      "UPDATE payment_attempts SET status='DISPATCHING',dispatch_started_at=now()-interval '2 minutes' WHERE id=$1",
      [attempt.id],
    );
    await recoverDispatches();
    await executeRefund(a.workspaceId, attempt.id);
    expect(
      (await one<Attempt>(pool, "SELECT * FROM payment_attempts WHERE id=$1", [
        attempt.id,
      ]))!.status,
    ).toBe("OUTCOME_UNKNOWN");
    expect(
      (
        await pool.query(
          "SELECT * FROM fixture_provider_events WHERE attempt_id=$1",
          [attempt.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("I-04 timeout after acceptance stays unknown; repeat cannot resend", async () => {
    const a = await workspace();
    const { approval } = await approved(a, "RR-021");
    const attempt = await reserve(a, approval.id);
    await executeRefund(a.workspaceId, attempt.id);
    await reserve(a, approval.id);
    await executeRefund(a.workspaceId, attempt.id);
    await reconcileRefund(a.workspaceId, attempt.id);
    expect(
      (await one<Attempt>(pool, "SELECT * FROM payment_attempts WHERE id=$1", [
        attempt.id,
      ]))!.status,
    ).toBe("OUTCOME_UNKNOWN");
    expect(
      (
        await pool.query(
          "SELECT * FROM fixture_provider_events WHERE attempt_id=$1",
          [attempt.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("I-05 known pending record reconciles through GET only", async () => {
    const a = await workspace();
    const { approval, row } = await approved(a);
    const attempt = await reserve(a, approval.id);
    const adapter = new FixturePaymentAdapter(row);
    adapter.getRefund = async (id) => ({
      id,
      captureId: attempt.capture_id,
      amountMinor: "4900",
      currency: "USD",
      status: "PENDING",
      raw: { simulation: true },
    });
    await executeRefund(a.workspaceId, attempt.id, adapter);
    expect(
      (await one<Attempt>(pool, "SELECT * FROM payment_attempts WHERE id=$1", [
        attempt.id,
      ]))!.status,
    ).toBe("PROVIDER_PENDING");
    adapter.getRefund = async (id) => ({
      id,
      captureId: attempt.capture_id,
      amountMinor: "4900",
      currency: "USD",
      status: "COMPLETED",
      raw: { simulation: true },
    });
    await reconcileRefund(a.workspaceId, attempt.id, adapter);
    expect(
      (await one<Attempt>(pool, "SELECT * FROM payment_attempts WHERE id=$1", [
        attempt.id,
      ]))!.status,
    ).toBe("COMPLETED");
    expect(
      (
        await pool.query(
          "SELECT * FROM fixture_provider_events WHERE attempt_id=$1",
          [attempt.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("recovers a discovered refund into the existing unknown attempt without sending", async () => {
    const a = await workspace(),
      { approval, row } = await approved(a);
    const attempt = await reserve(a, approval.id);
    await pool.query(
      "UPDATE payment_attempts SET status='DISPATCHING',dispatch_started_at=now()-interval '2 minutes' WHERE id=$1",
      [attempt.id],
    );
    await recoverDispatches();
    const adapter = new FixturePaymentAdapter(row),
      original = adapter.getCapture.bind(adapter);
    adapter.getCapture = async (id) => ({
      ...(await original(id)),
      status: "REFUNDED",
    });
    const findRefund = vi.fn(async () => ({
      id: "SIM_DISCOVERED_REFUND",
      captureId: attempt.capture_id,
      amountMinor: "4900",
      currency: "USD",
      status: "COMPLETED",
      raw: { simulation: true },
    }));
    const post = vi.spyOn(adapter, "refundCapture");
    await reconcileRefund(
      a.workspaceId,
      attempt.id,
      Object.assign(adapter, { findRefund }),
    );
    const saved = await one<Attempt>(
      pool,
      "SELECT * FROM payment_attempts WHERE id=$1",
      [attempt.id],
    );
    expect(saved!.status).toBe("COMPLETED");
    expect(saved!.provider_refund_id).toBe("SIM_DISCOVERED_REFUND");
    expect(post).not.toHaveBeenCalled();
    expect((await reserve(a, approval.id)).id).toBe(attempt.id);
    expect(
      (
        await pool.query(
          "SELECT verified_state FROM payment_links WHERE id=$1",
          [row.payment_link_id],
        )
      ).rows[0].verified_state,
    ).toBe("REFUNDED");
    expect(
      (
        await pool.query(
          "SELECT id FROM audit_events WHERE entity_id=$1 AND event_type='REFUND_DISCOVERED_BY_GET'",
          [attempt.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("rejects a wrong discovered refund amount and preserves the unknown attempt", async () => {
    const a = await workspace(),
      { approval, row } = await approved(a),
      attempt = await reserve(a, approval.id);
    await pool.query(
      "UPDATE payment_attempts SET status='DISPATCHING',dispatch_started_at=now()-interval '2 minutes' WHERE id=$1",
      [attempt.id],
    );
    await recoverDispatches();
    const adapter = new FixturePaymentAdapter(row),
      post = vi.spyOn(adapter, "refundCapture");
    await expect(
      reconcileRefund(
        a.workspaceId,
        attempt.id,
        Object.assign(adapter, {
          findRefund: async () => ({
            id: "wrong",
            captureId: attempt.capture_id,
            amountMinor: "1",
            currency: "USD",
            status: "COMPLETED",
            raw: { simulation: true },
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "VERIFICATION_UNAVAILABLE" });
    const saved = await one<Attempt>(
      pool,
      "SELECT * FROM payment_attempts WHERE id=$1",
      [attempt.id],
    );
    expect(saved!.status).toBe("OUTCOME_UNKNOWN");
    expect(saved!.provider_refund_id).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it("I-06 external partial refund blocks preflight", async () => {
    const a = await workspace();
    const { approval, row } = await approved(a);
    const attempt = await reserve(a, approval.id);
    const adapter = new FixturePaymentAdapter(row);
    const original = adapter.getCapture.bind(adapter);
    adapter.getCapture = async (id) => ({
      ...(await original(id)),
      status: "PARTIALLY_REFUNDED",
    });
    await executeRefund(a.workspaceId, attempt.id, adapter);
    expect(
      (await one<Attempt>(pool, "SELECT * FROM payment_attempts WHERE id=$1", [
        attempt.id,
      ]))!.status,
    ).toBe("BLOCKED_BEFORE_DISPATCH");
    expect(
      (
        await pool.query(
          "SELECT * FROM fixture_provider_events WHERE attempt_id=$1",
          [attempt.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("I-07 wrong refund capture association never completes", async () => {
    const a = await workspace();
    const { approval, row } = await approved(a);
    const attempt = await reserve(a, approval.id);
    const adapter = new FixturePaymentAdapter(row);
    const original = adapter.refundCapture.bind(adapter);
    adapter.refundCapture = async (x) => ({
      ...(await original(x)),
      captureId: "wrong-capture",
    });
    await executeRefund(a.workspaceId, attempt.id, adapter);
    expect(
      (await one<Attempt>(pool, "SELECT * FROM payment_attempts WHERE id=$1", [
        attempt.id,
      ]))!.status,
    ).toBe("OUTCOME_UNKNOWN");
  });
  it("I-08 unverified imported capture cannot authorize a refund", async () => {
    const row = await caseFor(actor, "RR-006");
    expect(row.match_state).toBe("EXACT_MATCH");
    await expect(createProposal(actor, row.id)).rejects.toMatchObject({
      code: "PAYMENT_NOT_OWNED",
    });
  });
  it("I-09 updated source makes approval stale", async () => {
    const a = await workspace();
    const { approval, row } = await approved(a);
    await pool.query(
      "INSERT INTO source_versions(id,workspace_id,source_id,version,raw_json,raw_snapshot,documents,content_hash,source_date,fetched_at,freshness_status,origin) SELECT $1,workspace_id,source_id,2,raw_json,raw_snapshot,documents,'newhash',source_date,now(),'CACHED_FIXTURE',origin FROM source_versions WHERE id=$2",
      [randomUUID(), row.source_version_id],
    );
    await expect(reserve(a, approval.id)).rejects.toMatchObject({
      code: "RULE_UNREVIEWED",
    });
  });
  it("I-10 policy revoked after reservation blocks dispatch", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    const attempt = await reserve(a, approval.id);
    await pool.query(
      "UPDATE merchant_policies SET active=false WHERE workspace_id=$1",
      [a.workspaceId],
    );
    await executeRefund(a.workspaceId, attempt.id);
    expect(
      (await one<Attempt>(pool, "SELECT * FROM payment_attempts WHERE id=$1", [
        attempt.id,
      ]))!.status,
    ).toBe("BLOCKED_BEFORE_DISPATCH");
  });
  it("I-11 foreign workspace IDs return not found", async () => {
    const other = await workspace();
    const row = await caseFor(actor);
    await expect(
      loadCase(pool, other.workspaceId, row.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
  it("I-13 completion cannot be downgraded even through SQL", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    const attempt = await reserve(a, approval.id);
    await executeRefund(a.workspaceId, attempt.id);
    await expect(
      pool.query(
        "UPDATE payment_attempts SET status='PROVIDER_PENDING' WHERE id=$1",
        [attempt.id],
      ),
    ).rejects.toThrow("Final attempt");
  });
  it("I-14 persisted attempt and audit are readable through a fresh connection", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    const attempt = await reserve(a, approval.id);
    const db = await pool.connect();
    try {
      expect(
        (
          await db.query("SELECT id FROM payment_attempts WHERE id=$1", [
            attempt.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await db.query("SELECT id FROM audit_events WHERE entity_id=$1", [
            attempt.id,
          ])
        ).rowCount,
      ).toBe(1);
    } finally {
      db.release();
    }
  });
  it("I-15 job insert failure rolls back reservation before any provider call", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    await pool.query(
      "CREATE FUNCTION reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER reject_test_job BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION reject_test_job()",
    );
    try {
      await expect(reserve(a, approval.id)).rejects.toThrow("test failure");
      expect(
        (
          await pool.query(
            "SELECT id FROM payment_attempts WHERE workspace_id=$1",
            [a.workspaceId],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.query(
        "DROP TRIGGER reject_test_job ON jobs; DROP FUNCTION reject_test_job()",
      );
    }
  });
  it("approval payload is immutable at the database boundary", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    await expect(
      pool.query(
        "UPDATE approvals SET approved_fingerprint='changed' WHERE id=$1",
        [approval.id],
      ),
    ).rejects.toThrow("immutable");
  });
  it("existing attempt is returned after approval revocation", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    const attempt = await reserve(a, approval.id);
    await pool.query("UPDATE approvals SET revoked_at=now() WHERE id=$1", [
      approval.id,
    ]);
    expect((await reserve(a, approval.id)).id).toBe(attempt.id);
  });
  it("existing attempt is returned after the approval lifetime expires", async () => {
    const a = await workspace();
    const { approval } = await approved(a);
    const attempt = await reserve(a, approval.id);
    const expired = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 20 * 60_000);
    try {
      expect((await reserve(a, approval.id)).id).toBe(attempt.id);
    } finally {
      expired.mockRestore();
    }
  });
  it("RR-012 historical exact match has no action permission", async () => {
    const row = await caseFor(actor, "RR-012");
    expect(row.match_state).toBe("EXACT_MATCH");
    expect(casePermission(row, "OPERATOR").reasons).toContain("SOURCE_STALE");
  });
});
