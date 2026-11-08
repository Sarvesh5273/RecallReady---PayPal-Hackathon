import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  authorize,
  requireOrigin,
  issueSession,
  setSession,
  rateLimit,
} from "@/lib/auth/session";
import { checkPassword } from "@/lib/auth/passwords";
import { pool, one, transaction } from "@/lib/db";
import { BusinessError, notFound } from "@/lib/errors";
import { newSimulation } from "@/lib/services/seed";
import { listCases, caseDetail, loadCase } from "@/lib/services/cases";
import {
  createProposal,
  approve,
  reserve,
  lockWorkspace,
  enqueue,
  type Attempt,
} from "@/lib/services/execution";
import { reviewRule } from "@/lib/services/rules";
import { receipt } from "@/lib/services/receipts";
import { createSandboxOrder, captureSandboxOrder } from "@/lib/services/setup";
import { recallDigits } from "@/lib/adapters/cpsc";
import { sandboxConfigured } from "@/lib/adapters/paypal";
import { extractionReadiness } from "@/lib/adapters/extraction";
import { matchProduct } from "@/lib/domain/matching";
import { audit } from "@/lib/observability/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const empty = z.object({}).strict();
const id = z.string().uuid();
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 16000)
    throw new BusinessError(
      "BODY_TOO_LARGE",
      "Request exceeds the input limit.",
      400,
    );
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new BusinessError("INVALID_JSON", "Send valid JSON.", 400);
  }
}
async function handle(
  request: Request,
  { params }: { params: Promise<{ segments: string[] }> },
) {
  const correlationId = randomUUID();
  try {
    const path = (await params).segments;
    const [area, entity, action] = path;
    const verb = request.method;
    if (area === "health" && verb === "GET") {
      if (entity === "ready") {
        const migrations = await pool.query(
          "SELECT name FROM schema_migrations WHERE name=ANY($1::text[])",
          [
            [
              "001_core.sql",
              "002_immutable_trigger.sql",
              "003_extraction_provider.sql",
              "004_gemini_provider.sql",
            ],
          ],
        );
        if (migrations.rowCount !== 4)
          throw new BusinessError(
            "MIGRATIONS_REQUIRED",
            "Database migrations are incomplete.",
            503,
          );
      }
      return json({ status: "ok" });
    }
    if (area === "demo" && entity === "simulation" && verb === "POST") {
      requireOrigin(request);
      empty.parse(await body(request));
      if (process.env.PUBLIC_SIMULATION_ENABLED === "false")
        throw new BusinessError(
          "DEMO_DISABLED",
          "Public simulation is disabled.",
          403,
        );
      await rateLimit(pool, "global:simulation", 100, 3600);
      const result = await newSimulation();
      await setSession(result);
      return json({ workspaceId: result.workspaceId, mode: "SIMULATION" });
    }
    if (area === "session" && entity === "login" && verb === "POST") {
      requireOrigin(request);
      const data = z
        .object({
          email: z.string().email().max(254),
          password: z.string().max(200),
        })
        .strict()
        .parse(await body(request));
      await rateLimit(pool, "login:" + data.email.toLowerCase(), 8, 900);
      const user = await one<{ id: string; password_hash: string }>(
        pool,
        "SELECT id,password_hash FROM users WHERE email=$1",
        [data.email.toLowerCase()],
      );
      const valid = await checkPassword(
        data.password,
        user?.password_hash ??
          "00000000000000000000000000000000:" + "00".repeat(64),
      );
      if (!user || !valid)
        throw new BusinessError(
          "LOGIN_FAILED",
          "Email or password is incorrect.",
          401,
        );
      const membership = await one<{ workspace_id: string }>(
        pool,
        "SELECT m.workspace_id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.expires_at IS NULL ORDER BY w.created_at DESC LIMIT 1",
        [user.id],
      );
      if (!membership)
        throw new BusinessError(
          "LOGIN_FAILED",
          "No owner workspace is available.",
          401,
        );
      await setSession(
        await issueSession(pool, user.id, membership.workspace_id),
      );
      return json({ ok: true });
    }
    const actor = await authorize(
      request,
      verb === "GET" ? ["OWNER", "OPERATOR", "VIEWER"] : ["OWNER", "OPERATOR"],
    );
    if (area === "session" && verb === "GET")
      return json({
        mode: actor.mode,
        role: actor.role,
        workspaceId: actor.workspaceId,
        workspaceName: actor.workspaceName,
      });
    if (area === "session" && entity === "logout" && verb === "POST") {
      empty.parse(await body(request));
      await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
        actor.sessionId,
      ]);
      const jar = await cookies();
      jar.delete("rr_session");
      jar.delete("rr_csrf");
      return json({ ok: true });
    }
    if (area === "cases" && verb === "GET" && !entity) {
      const rows = await listCases(actor);
      return json(
        rows.map((c) => ({
          id: c.id,
          display_id: c.display_id,
          customer_label: c.customer_label,
          brand: c.brand,
          model: c.model,
          match_state: c.match_state,
          match_reasons: c.match_reasons,
          permission: c.permission,
          amount_minor: c.amount_minor,
          currency: c.currency,
          courtesy_state: c.courtesy_state,
          attempt_status: c.attempt_status,
          updated_at: c.updated_at,
          scenario: c.scenario,
          source_version_id: c.source_version_id,
        })),
      );
    }
    if (area === "cases" && entity) {
      id.parse(entity);
      if (verb === "GET") {
        if (action === "receipt") return json(await receipt(actor, entity));
        return json(await caseDetail(actor, entity));
      }
      empty.parse(await body(request));
      if (action === "proposal")
        return json(await createProposal(actor, entity));
      if (action === "evaluate") {
        return json(
          await transaction(async (db) => {
            await lockWorkspace(db, actor.workspaceId);
            const row = await loadCase(db, actor.workspaceId, entity);
            const m = matchProduct(
              {
                brand: row.brand,
                model: row.model,
                serial: row.serial,
                dateCode: row.date_code,
              },
              row.rule,
            );
            await db.query(
              "UPDATE cases SET match_state=$1,match_reasons=$2,revision=revision+1 WHERE id=$3 AND workspace_id=$4",
              [m.state, JSON.stringify(m.reasons), entity, actor.workspaceId],
            );
            return m;
          }),
        );
      }
    }
    if (area === "proposals" && action === "approve" && verb === "POST") {
      id.parse(entity);
      const data = z
        .object({
          proposalFingerprint: z.string().length(64),
          confirmation: z.literal(true),
          note: z.string().max(1000).optional(),
        })
        .strict()
        .parse(await body(request));
      return json(await approve(actor, entity, data));
    }
    if (area === "approvals" && verb === "POST") {
      id.parse(entity);
      empty.parse(await body(request));
      if (action === "execute") {
        const a = await reserve(actor, entity);
        return json(
          {
            id: a.id,
            status: a.status,
            existing: a.existing,
            approval_id: a.approval_id,
            mode: a.mode,
            amount_minor: a.amount_minor,
            currency: a.currency,
            provider_refund_id: a.provider_refund_id,
            provider_status: a.provider_status,
            created_at: a.created_at,
            updated_at: a.updated_at,
          },
          a.existing ? 200 : 202,
        );
      }
      if (action === "revoke") {
        await transaction(async (db) => {
          await lockWorkspace(db, actor.workspaceId);
          const a = await one<{ id: string }>(
            db,
            "SELECT id FROM approvals WHERE id=$1 AND workspace_id=$2",
            [entity, actor.workspaceId],
          );
          if (!a) notFound();
          const dispatched = await one(
            db,
            "SELECT id FROM payment_attempts WHERE approval_id=$1 AND workspace_id=$2 AND dispatch_started_at IS NOT NULL",
            [entity, actor.workspaceId],
          );
          if (dispatched)
            throw new BusinessError(
              "ALREADY_DISPATCHED",
              "Revocation cannot cancel a dispatched provider request.",
            );
          await db.query(
            "UPDATE approvals SET revoked_at=now() WHERE id=$1 AND workspace_id=$2",
            [entity, actor.workspaceId],
          );
          await audit(
            db,
            actor.workspaceId,
            "APPROVAL_REVOKED",
            entity,
            {},
            actor.userId,
          );
        });
        return json({ ok: true });
      }
    }
    if (area === "attempts") {
      id.parse(entity);
      const a = await one<Attempt>(
        pool,
        "SELECT * FROM payment_attempts WHERE id=$1 AND workspace_id=$2",
        [entity, actor.workspaceId],
      );
      if (!a) notFound();
      if (verb === "GET")
        return json({
          id: a.id,
          approval_id: a.approval_id,
          case_id: a.case_id,
          mode: a.mode,
          amount_minor: a.amount_minor,
          currency: a.currency,
          status: a.status,
          provider_refund_id: a.provider_refund_id,
          provider_status: a.provider_status,
          failure_code: a.failure_code,
          verification_stale: a.verification_stale,
          paypal_request_id: a.paypal_request_id,
          created_at: a.created_at,
          updated_at: a.updated_at,
        });
      if (action === "reconcile" && verb === "POST") {
        empty.parse(await body(request));
        await enqueue(pool, actor.workspaceId, "RECONCILE_REFUND", {
          attemptId: entity,
        });
        return json({ queued: true }, 202);
      }
    }
    if (area === "sources" && verb === "GET") {
      const args = [actor.workspaceId];
      let query =
        "SELECT s.id AS source_id,s.canonical_url,v.*,e.id AS extraction_id,e.candidate,e.validation_errors,e.status AS extraction_status,e.model AS extraction_model,e.provider AS extraction_provider,r.id AS reviewed_rule_id,r.rule,r.revision AS rule_revision,r.review_note,r.reviewed_at,r.expires_at AS review_expires_at FROM recall_sources s JOIN LATERAL(SELECT * FROM source_versions WHERE source_id=s.id AND workspace_id=s.workspace_id ORDER BY version DESC LIMIT 1)v ON true LEFT JOIN LATERAL(SELECT * FROM extractions WHERE source_version_id=v.id AND workspace_id=s.workspace_id ORDER BY created_at DESC LIMIT 1)e ON true LEFT JOIN LATERAL(SELECT * FROM reviewed_rules WHERE source_version_id=v.id AND workspace_id=s.workspace_id ORDER BY revision DESC LIMIT 1)r ON true WHERE s.workspace_id=$1";
      if (entity) {
        id.parse(entity);
        query += " AND s.id=$2";
        args.push(entity);
      }
      const source = await one(pool, query, args);
      if (!source) notFound();
      const limits = await pool.query<{
        key: string;
        remaining: number;
        reset_at: Date;
      }>(
        "SELECT key,GREATEST(0,5-count) AS remaining,reset_at FROM rate_limits WHERE key=ANY($1::text[]) AND reset_at>now()",
        [["extract:" + actor.workspaceId, "source:" + actor.workspaceId]],
      );
      const extractionLimit = limits.rows.find((r) =>
        r.key.startsWith("extract:"),
      );
      const sourceLimit = limits.rows.find((r) => r.key.startsWith("source:"));
      const pending = await one(
        pool,
        "SELECT id FROM jobs WHERE workspace_id=$1 AND status IN('READY','RUNNING') AND (kind='INGEST_SOURCE' OR (kind='EXTRACT_SOURCE' AND payload->>'sourceVersionId'=$2)) LIMIT 1",
        [actor.workspaceId, source.id],
      );
      return json({
        ...source,
        work_pending: !!pending,
        extraction_remaining: extractionLimit?.remaining ?? 5,
        extraction_reset_at: extractionLimit?.reset_at ?? null,
        recheck_remaining: sourceLimit?.remaining ?? 5,
        recheck_reset_at: sourceLimit?.reset_at ?? null,
      });
    }
    if (area === "sources" && verb === "POST") {
      if (actor.mode !== "PAYPAL_SANDBOX")
        throw new BusinessError(
          "MODE_MISMATCH",
          "Simulation uses cached source fixtures. Live imports require an owner sandbox workspace.",
          422,
        );
      let digits: string;
      if (entity === "import") {
        digits = recallDigits(
          z
            .object({ recallNumber: z.string() })
            .strict()
            .parse(await body(request)).recallNumber,
        );
      } else {
        empty.parse(await body(request));
        id.parse(entity);
        const s = await one<{ recall_number: string }>(
          pool,
          "SELECT recall_number FROM recall_sources WHERE id=$1 AND workspace_id=$2",
          [entity, actor.workspaceId],
        );
        if (!s) notFound();
        digits = s.recall_number;
      }
      await rateLimit(pool, "source:" + actor.workspaceId, 5, 3600);
      await enqueue(pool, actor.workspaceId, "INGEST_SOURCE", {
        recallNumber: digits,
      });
      return json({ queued: true }, 202);
    }
    if (area === "extractions" && verb === "GET") {
      id.parse(entity);
      const e = await one(
        pool,
        "SELECT * FROM extractions WHERE id=$1 AND workspace_id=$2",
        [entity, actor.workspaceId],
      );
      if (!e) notFound();
      return json(e);
    }
    if (area === "rules" && entity === "review" && verb === "POST") {
      const data = z
        .object({
          sourceVersionId: id,
          extractionId: id,
          conflictNote: z.string().min(40).max(2000),
          confirmation: z.literal(true),
        })
        .strict()
        .parse(await body(request));
      return json(await reviewRule(actor, data));
    }
    if (area === "activity" && verb === "GET")
      return json(
        (
          await pool.query(
            "SELECT * FROM audit_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
            [actor.workspaceId],
          )
        ).rows,
      );
    if (area === "demo" && entity === "setup") {
      if (action === "config" && verb === "GET") {
        const purchase =
          actor.mode === "PAYPAL_SANDBOX"
            ? await one(
                pool,
                "SELECT p.provider_order_id,p.capture_id,p.verified_state,p.owned,p.amount_minor,p.currency,p.verified_at FROM payment_links p JOIN orders o ON o.id=p.order_id AND o.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND p.mode='PAYPAL_SANDBOX' AND o.display_id='RR-001'",
                [actor.workspaceId],
              )
            : null;
        return json({
          mode: actor.mode,
          paypalReady: sandboxConfigured(),
          aiReady: extractionReadiness().configured,
          aiProvider: extractionReadiness().provider,
          aiModel: extractionReadiness().model,
          clientId:
            actor.mode === "PAYPAL_SANDBOX"
              ? (process.env.PAYPAL_CLIENT_ID ?? null)
              : null,
          studioEnabled: false,
          purchase: purchase ?? null,
        });
      }
      if (verb === "POST" && action === "order") {
        empty.parse(await body(request));
        return json(await createSandboxOrder(actor));
      }
      if (verb === "POST" && action === "capture") {
        const data = z
          .object({ orderId: z.string().min(1).max(100) })
          .strict()
          .parse(await body(request));
        return json(await captureSandboxOrder(actor, data.orderId));
      }
    }
    if (area === "demo" && entity === "evidence" && verb === "GET")
      return json(
        (
          await pool.query(
            "SELECT mode,evidence,build_commit,recorded_at FROM demo_evidence_runs WHERE workspace_id=$1",
            [actor.workspaceId],
          )
        ).rows,
      );
    notFound();
  } catch (e) {
    const error =
      e instanceof BusinessError
        ? e
        : e instanceof z.ZodError
          ? new BusinessError(
              "INVALID_INPUT",
              "Request fields do not match the endpoint contract.",
              400,
            )
          : new BusinessError(
              "DEPENDENCY_UNAVAILABLE",
              "The operation could not be completed. Check the server and worker.",
              503,
            );
    console.error(JSON.stringify({ correlationId, code: error.code }));
    return NextResponse.json(
      { error: { code: error.code, message: error.message, correlationId } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export const GET = handle;
export const POST = handle;
