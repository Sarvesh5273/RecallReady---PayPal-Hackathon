import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { pool, one, type DB } from "../db";
import { sha256 } from "../domain/approvals";
import type { Mode } from "../domain/types";
import { BusinessError } from "../errors";
export type Actor = {
  userId: string;
  workspaceId: string;
  sessionId: string;
  role: "OWNER" | "OPERATOR" | "VIEWER";
  mode: Mode;
  merchantId: string;
  workspaceName: string;
  csrfHash: string;
};
export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get("rr_session")?.value;
  if (!token) return null;
  return (
    (await one<Actor>(
      pool,
      `SELECT s.id AS "sessionId",s.user_id AS "userId",s.workspace_id AS "workspaceId",s.csrf_hash AS "csrfHash",m.role,w.mode,w.name AS "workspaceName",w.merchant_id AS "merchantId" FROM sessions s JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id JOIN workspaces w ON w.id=s.workspace_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND (w.expires_at IS NULL OR w.expires_at>now())`,
      [sha256(token)],
    )) ?? null
  );
}
export async function issueSession(
  db: DB,
  userId: string,
  workspaceId: string,
) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO sessions(id,token_hash,csrf_hash,user_id,workspace_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '8 hours')",
    [randomUUID(), sha256(token), sha256(csrf), userId, workspaceId],
  );
  return { token, csrf };
}
export async function setSession(value: { token: string; csrf: string }) {
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE === "true",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 28800,
  };
  jar.set("rr_session", value.token, options);
  jar.set("rr_csrf", value.csrf, { ...options, httpOnly: false });
}
export async function authorize(
  request: Request,
  roles: Actor["role"][] = ["OWNER", "OPERATOR", "VIEWER"],
): Promise<Actor> {
  const actor = await currentActor();
  if (!actor)
    throw new BusinessError(
      "SESSION_REQUIRED",
      "Start an isolated simulation or sign in.",
      401,
    );
  if (!roles.includes(actor.role))
    throw new BusinessError(
      "PERMISSION_REQUIRED",
      "This action requires operator access.",
      403,
    );
  if (request.method !== "GET") {
    requireOrigin(request);
    const csrf = request.headers.get("x-csrf-token");
    if (!csrf)
      throw new BusinessError(
        "CSRF_INVALID",
        "Refresh the page before continuing.",
        403,
      );
    const actual = Buffer.from(sha256(csrf));
    const expected = Buffer.from(actor.csrfHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new BusinessError(
        "CSRF_INVALID",
        "Refresh the page before continuing.",
        403,
      );
  }
  return actor;
}
export function requireOrigin(request: Request) {
  const expected = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000")
    .origin;
  if (request.headers.get("origin") !== expected)
    throw new BusinessError(
      "ORIGIN_INVALID",
      "Use the application from its configured origin.",
      403,
    );
  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/json")
  )
    throw new BusinessError("INVALID_CONTENT_TYPE", "Send JSON.", 400);
}
export async function rateLimit(
  db: DB,
  key: string,
  max: number,
  seconds: number,
) {
  const row = await one<{ count: number }>(
    db,
    `INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END RETURNING count`,
    [key, seconds],
  );
  if (row!.count > max)
    throw new BusinessError(
      "QUOTA_EXCEEDED",
      "Request limit reached. Wait before trying again.",
      429,
    );
}
