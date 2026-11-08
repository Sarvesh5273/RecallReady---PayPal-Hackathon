import { randomUUID } from "node:crypto";
import type { DB } from "../db";
export async function audit(
  db: DB,
  workspaceId: string,
  eventType: string,
  entityId: string,
  details: Record<string, unknown>,
  actorId = "worker",
  correlationId: string = randomUUID(),
) {
  await db.query(
    "INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,event_type,entity_type,entity_id,correlation_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      workspaceId,
      actorId === "worker" ? "WORKER" : "USER",
      actorId,
      eventType,
      "WORKFLOW",
      entityId,
      correlationId,
      JSON.stringify(details),
    ],
  );
}
