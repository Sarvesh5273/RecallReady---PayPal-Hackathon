import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { pool, transaction, one } from "../lib/db";
import {
  executeRefund,
  reconcileRefund,
  recoverDispatches,
} from "./handlers/refund";
import { ingestSource, runExtraction } from "../lib/services/ingestion";
type Job = {
  id: string;
  workspace_id: string;
  kind: string;
  payload: {
    attemptId?: string;
    recallNumber?: string;
    sourceVersionId?: string;
  };
  attempts: number;
};
const workerId = randomUUID();
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
export async function tick() {
  await recoverDispatches();
  // Expired job leases are reclaimable; executeRefund's dispatch CAS prevents a second write.
  await pool.query(
    "UPDATE jobs SET status='READY',locked_at=NULL,locked_by=NULL WHERE status='RUNNING' AND locked_at<now()-interval '90 seconds'",
  );
  const job = await transaction(async (db) => {
    const next = await one<Job>(
      db,
      "SELECT * FROM jobs WHERE status='READY' AND run_after<=now() ORDER BY run_after,created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!next) return null;
    await db.query(
      "UPDATE jobs SET status='RUNNING',attempts=attempts+1,locked_at=now(),locked_by=$1 WHERE id=$2",
      [workerId, next.id],
    );
    return next;
  });
  if (!job) return false;
  try {
    if (job.kind === "EXECUTE_REFUND")
      await executeRefund(job.workspace_id, job.payload.attemptId!);
    else if (job.kind === "RECONCILE_REFUND")
      await reconcileRefund(job.workspace_id, job.payload.attemptId!);
    else if (job.kind === "INGEST_SOURCE")
      await ingestSource(job.workspace_id, job.payload.recallNumber!);
    else if (job.kind === "EXTRACT_SOURCE")
      await runExtraction(job.workspace_id, job.payload.sourceVersionId!);
    else throw new Error("UNKNOWN_JOB");
    await pool.query(
      "UPDATE jobs SET status='DONE',updated_at=now() WHERE id=$1 AND locked_by=$2",
      [job.id, workerId],
    );
    console.log(
      JSON.stringify({ job: job.id, kind: job.kind, status: "DONE" }),
    );
  } catch {
    await pool.query(
      "UPDATE jobs SET status=$1,run_after=now()+interval '20 seconds',error_code='HANDLER_FAILED',updated_at=now() WHERE id=$2 AND locked_by=$3",
      [
        job.kind === "EXECUTE_REFUND" || job.attempts >= 2 ? "FAILED" : "READY",
        job.id,
        workerId,
      ],
    );
    console.error(
      JSON.stringify({
        job: job.id,
        kind: job.kind,
        status: "FAILED_OR_BACKOFF",
      }),
    );
  }
  return true;
}
async function main() {
  console.log("RecallReady worker started");
  while (!stopped) {
    try {
      const ran = await tick();
      if (!ran) await setTimeout(800);
    } catch {
      console.error("Database unavailable; worker paused.");
      await setTimeout(3000);
    }
  }
  await pool.end();
}
if (process.argv[1]?.endsWith("index.ts")) main();
