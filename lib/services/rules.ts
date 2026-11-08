import { randomUUID } from "node:crypto";
import { transaction, one } from "../db";
import { lockWorkspace } from "./execution";
import type { Actor } from "../auth/session";
import {
  candidateSchema,
  type EvidenceDocument,
  type ProductRule,
} from "../domain/types";
import { validateCandidate, resolveQuote } from "../domain/evidence";
import { fingerprint } from "../domain/approvals";
import { matchProduct } from "../domain/matching";
import { BusinessError, notFound } from "../errors";
import { audit } from "../observability/audit";
export async function reviewRule(
  actor: Actor,
  input: {
    sourceVersionId: string;
    extractionId: string;
    conflictNote: string;
  },
) {
  return transaction(async (db) => {
    await lockWorkspace(db, actor.workspaceId);
    const source = await one<{
      documents: EvidenceDocument[];
      source_id: string;
      freshness_status: string;
      origin: string;
    }>(db, "SELECT * FROM source_versions WHERE id=$1 AND workspace_id=$2", [
      input.sourceVersionId,
      actor.workspaceId,
    ]);
    const extraction = await one<{ candidate: unknown; status: string }>(
      db,
      "SELECT * FROM extractions WHERE id=$1 AND source_version_id=$2 AND workspace_id=$3",
      [input.extractionId, input.sourceVersionId, actor.workspaceId],
    );
    if (!source || !extraction) notFound();
    const latest = await one<{ id: string }>(
      db,
      "SELECT id FROM source_versions WHERE source_id=$1 AND workspace_id=$2 ORDER BY version DESC LIMIT 1",
      [source.source_id, actor.workspaceId],
    );
    if (latest?.id !== input.sourceVersionId)
      throw new BusinessError(
        "SOURCE_CHANGED",
        "Review the latest source version.",
      );
    if (actor.mode === "PAYPAL_SANDBOX" && source.origin !== "CPSC_LIVE")
      throw new BusinessError(
        "SOURCE_STALE",
        "Sandbox rule review needs a live official source.",
      );
    if (extraction.status !== "CANDIDATE_READY")
      throw new BusinessError(
        "EXTRACTION_INVALID",
        "Extraction must pass validation.",
      );
    const candidate = validateCandidate(
      candidateSchema.parse(extraction.candidate),
      source.documents,
    );
    const product = candidate.products.find(
      (p) => p.model.value === "PB0003" && p.brand.value === "Belkin",
    );
    if (!product || product.serialScope !== "ALL_EXPLICIT")
      throw new BusinessError(
        "RULE_UNSUPPORTED",
        "Only evidence-backed Belkin PB0003 all-serial scope is supported in v1.",
        422,
      );
    const refs = product.model.evidence.map((e) =>
      resolveQuote(source.documents, e),
    );
    const serial = product.serialConditions
      .flatMap((f) => f.evidence)
      .filter(
        (e) =>
          e.quote.includes("PB0003") && /all serial numbers/i.test(e.quote),
      )
      .map((e) => resolveQuote(source.documents, e));
    if (!serial.length)
      throw new BusinessError(
        "EVIDENCE_INVALID",
        "Model-specific all-serial evidence is required.",
        422,
      );
    const rule: ProductRule = {
      brandExact: "Belkin",
      modelExact: "PB0003",
      serialRule: { kind: "ALL_EXPLICIT", evidence: serial },
      allowedDateCodes: null,
      evidence: refs,
      unresolvedBlockingConflicts: [],
    };
    const revision = (await one<{ revision: number }>(
      db,
      "SELECT COALESCE(max(revision),0)+1 AS revision FROM reviewed_rules WHERE workspace_id=$1",
      [actor.workspaceId],
    ))!.revision;
    await db.query(
      "UPDATE reviewed_rules SET superseded_at=now() WHERE workspace_id=$1 AND superseded_at IS NULL AND revoked_at IS NULL",
      [actor.workspaceId],
    );
    const id = randomUUID();
    await db.query(
      "INSERT INTO reviewed_rules(id,workspace_id,source_version_id,extraction_id,revision,rule,rule_hash,reviewer_id,review_note,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '24 hours')",
      [
        id,
        actor.workspaceId,
        input.sourceVersionId,
        input.extractionId,
        revision,
        JSON.stringify(rule),
        fingerprint(rule).hash,
        actor.userId,
        input.conflictNote,
      ],
    );
    const cases = (
      await db.query(
        "SELECT c.id,i.brand,i.model,i.serial,i.date_code FROM cases c JOIN order_items i ON i.id=c.order_item_id AND i.workspace_id=c.workspace_id WHERE c.workspace_id=$1",
        [actor.workspaceId],
      )
    ).rows;
    for (const c of cases) {
      const result = matchProduct(
        {
          brand: c.brand,
          model: c.model,
          serial: c.serial,
          dateCode: c.date_code,
        },
        rule,
      );
      await db.query(
        "UPDATE cases SET rule_id=$1,source_version_id=$2,revision=revision+1,match_state=$3,match_reasons=$4,updated_at=now() WHERE id=$5 AND workspace_id=$6",
        [
          id,
          input.sourceVersionId,
          result.state,
          JSON.stringify(result.reasons),
          c.id,
          actor.workspaceId,
        ],
      );
    }
    await audit(
      db,
      actor.workspaceId,
      "RULE_REVIEWED",
      source.source_id,
      {
        ruleId: id,
        revision,
        conflictNote: input.conflictNote,
        excludedAlias: "PB003",
      },
      actor.userId,
    );
    return { id, revision };
  });
}
