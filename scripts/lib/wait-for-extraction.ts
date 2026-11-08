import { setTimeout } from "node:timers/promises";
import { pool, one } from "../../lib/db";
import { BusinessError } from "../../lib/errors";
export async function waitForExtraction(
  workspaceId: string,
  sourceVersionId: string,
) {
  const deadline = Date.now() + 65000;
  while (Date.now() < deadline) {
    const extraction = await one<{ id: string; status: string }>(
      pool,
      "SELECT id,status FROM extractions WHERE workspace_id=$1 AND source_version_id=$2 ORDER BY created_at DESC LIMIT 1",
      [workspaceId, sourceVersionId],
    );
    const job = await one(
      pool,
      "SELECT id FROM jobs WHERE workspace_id=$1 AND kind='EXTRACT_SOURCE' AND payload->>'sourceVersionId'=$2 AND status IN('READY','RUNNING')",
      [workspaceId, sourceVersionId],
    );
    if (extraction && extraction.status !== "EXTRACTING" && !job)
      return extraction.id;
    await setTimeout(750);
  }
  throw new BusinessError(
    "EXTRACTION_PENDING",
    "Extraction is still queued or running. Check the worker and refresh Source & rules.",
  );
}
