import { randomUUID } from "node:crypto";
import { pool, one, transaction, type DB } from "../db";
import { fetchRecall } from "../adapters/cpsc";
import { extractSource, extractionReadiness } from "../adapters/extraction";
import { BusinessError } from "../errors";
import {
  ExtractionValidationError,
  EXTRACTION_PROMPT_VERSION,
} from "../adapters/extraction-contract";
import { lockWorkspace, enqueue } from "./execution";
import { audit } from "../observability/audit";
import type { EvidenceDocument } from "../domain/types";
import { rateLimit } from "../auth/session";
async function queueExtraction(
  db: DB,
  workspaceId: string,
  sourceVersionId: string,
) {
  const pending = await one(
    db,
    "SELECT id FROM jobs WHERE workspace_id=$1 AND kind='EXTRACT_SOURCE' AND payload->>'sourceVersionId'=$2 AND status IN('READY','RUNNING')",
    [workspaceId, sourceVersionId],
  );
  if (!pending)
    await enqueue(db, workspaceId, "EXTRACT_SOURCE", { sourceVersionId });
}
export async function ingestSource(workspaceId: string, recallNumber: string) {
  const snapshot = await fetchRecall(recallNumber);
  return transaction(async (db) => {
    await lockWorkspace(db, workspaceId);
    let source = await one<{ id: string }>(
      db,
      "SELECT id FROM recall_sources WHERE workspace_id=$1 AND recall_number=$2",
      [workspaceId, snapshot.digits],
    );
    if (!source) {
      source = { id: randomUUID() };
      await db.query(
        "INSERT INTO recall_sources(id,workspace_id,recall_number,canonical_url) VALUES($1,$2,$3,$4)",
        [source.id, workspaceId, snapshot.digits, snapshot.url],
      );
    }
    const latest = await one<{
      id: string;
      version: number;
      content_hash: string;
    }>(
      db,
      "SELECT id,version,content_hash FROM source_versions WHERE workspace_id=$1 AND source_id=$2 ORDER BY version DESC LIMIT 1",
      [workspaceId, source.id],
    );
    if (latest?.content_hash === snapshot.hash) {
      await db.query(
        "UPDATE source_versions SET freshness_checked_at=now(),freshness_status='CURRENT' WHERE id=$1 AND workspace_id=$2",
        [latest.id, workspaceId],
      );
      const extraction = await one<{ status: string }>(
        db,
        "SELECT status FROM extractions WHERE source_version_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 1",
        [latest.id, workspaceId],
      );
      if (!extraction || extraction.status === "EXTRACTION_FAILED")
        await queueExtraction(db, workspaceId, latest.id);
      await audit(db, workspaceId, "SOURCE_RECHECKED", source.id, {
        sourceVersionId: latest.id,
      });
      return latest.id;
    }
    const id = randomUUID();
    await db.query(
      "INSERT INTO source_versions(id,workspace_id,source_id,version,raw_json,raw_snapshot,documents,content_hash,source_date,fetched_at,freshness_checked_at,freshness_status,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),'CURRENT','CPSC_LIVE')",
      [
        id,
        workspaceId,
        source.id,
        (latest?.version ?? 0) + 1,
        JSON.stringify(snapshot.raw),
        snapshot.html,
        JSON.stringify(snapshot.documents),
        snapshot.hash,
        snapshot.sourceDate,
        snapshot.fetchedAt,
      ],
    );
    await db.query(
      "UPDATE reviewed_rules SET superseded_at=now() WHERE workspace_id=$1 AND source_version_id IN(SELECT id FROM source_versions WHERE source_id=$2 AND workspace_id=$1 AND id<>$3) AND superseded_at IS NULL",
      [workspaceId, source.id, id],
    );
    await queueExtraction(db, workspaceId, id);
    await audit(db, workspaceId, "SOURCE_IMPORTED", source.id, {
      sourceVersionId: id,
      hash: snapshot.hash,
    });
    return id;
  });
}
export async function runExtraction(
  workspaceId: string,
  sourceVersionId: string,
) {
  const reserved = await transaction(async (db) => {
    await lockWorkspace(db, workspaceId);
    const source = await one<{ documents: EvidenceDocument[] }>(
      db,
      "SELECT documents FROM source_versions WHERE id=$1 AND workspace_id=$2",
      [sourceVersionId, workspaceId],
    );
    if (!source) throw new Error("NOT_FOUND");
    const existing = await one<{ id: string; status: string; active: boolean }>(
      db,
      "SELECT id,status,created_at>now()-interval '90 seconds' AS active FROM extractions WHERE workspace_id=$1 AND source_version_id=$2 ORDER BY created_at DESC LIMIT 1",
      [workspaceId, sourceVersionId],
    );
    if (
      existing?.status === "CANDIDATE_READY" ||
      (existing?.status === "EXTRACTING" && existing.active)
    )
      return { id: existing.id, documents: null };
    if (existing?.status === "EXTRACTING")
      await db.query(
        "UPDATE extractions SET status='EXTRACTION_FAILED',validation_errors='[\"EXTRACTION_INTERRUPTED\"]' WHERE id=$1 AND workspace_id=$2",
        [existing.id, workspaceId],
      );
    await rateLimit(db, "extract:" + workspaceId, 5, 3600);
    const id = randomUUID(),
      config = extractionReadiness();
    await db.query(
      "INSERT INTO extractions(id,workspace_id,source_version_id,prompt_version,model,provider,status) VALUES($1,$2,$3,$4,$5,$6,'EXTRACTING')",
      [
        id,
        workspaceId,
        sourceVersionId,
        EXTRACTION_PROMPT_VERSION,
        config.model ?? "UNAVAILABLE",
        config.provider === "UNAVAILABLE" ? "FIXTURE" : config.provider,
      ],
    );
    return { id, documents: source.documents };
  });
  const { id } = reserved;
  if (!reserved.documents) return id;
  try {
    const result = await extractSource(reserved.documents);
    await pool.query(
      "UPDATE extractions SET candidate=$1,model=$2,provider_response_id=$3,status='CANDIDATE_READY',provider=$6 WHERE id=$4 AND workspace_id=$5",
      [
        JSON.stringify(result.candidate),
        result.model,
        result.responseId,
        id,
        workspaceId,
        result.provider,
      ],
    );
    await audit(pool, workspaceId, "EXTRACTION_READY", id, {
      sourceVersionId,
      model: result.model,
      provider: result.provider,
    });
  } catch (error) {
    if (error instanceof ExtractionValidationError)
      await pool.query(
        "UPDATE extractions SET candidate=$1,model=COALESCE($2,model),provider_response_id=$3 WHERE id=$4 AND workspace_id=$5",
        [
          JSON.stringify(error.candidate),
          error.model ?? null,
          error.responseId ?? null,
          id,
          workspaceId,
        ],
      );
    await pool.query(
      "UPDATE extractions SET status='EXTRACTION_FAILED',validation_errors=$1 WHERE id=$2 AND workspace_id=$3",
      [
        JSON.stringify(
          error instanceof ExtractionValidationError
            ? [error.code, error.diagnostic, ...error.issuePaths]
            : [
                error instanceof BusinessError
                  ? error.code
                  : "AI_EXTRACTION_FAILED",
              ],
        ),
        id,
        workspaceId,
      ],
    );
    await audit(pool, workspaceId, "EXTRACTION_FAILED", id, {
      sourceVersionId,
    });
  }
  return id;
}
