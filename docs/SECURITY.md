# Security and recovery

## Implemented controls

- High-entropy session/CSRF tokens; only hashes in PostgreSQL. HttpOnly session cookie, SameSite Strict, configurable Secure for HTTPS.
- Origin checks, strict JSON schemas, role authorization, scoped queries, and non-disclosing foreign-ID 404 responses.
- SQL-backed login, simulation, source, extraction, and sandbox setup quotas. Public simulations cannot access live model or payment adapters.
- Server-owned order/capture mapping; no endpoint accepts a browser's cart amount, arbitrary capture ID, merchant, mode, or approval state.
- Positive bigint money, USD execution, fixed single-item/quantity-one policy, no prior refunds, exact immutable fingerprints.
- One dispatch transition; no blind refund POST retry after timeout, 409, ambiguous 5xx, malformed response, or worker crash.
- GET-verified refund identity and status; unknown/missing association never becomes completed. Final states cannot be downgraded by late pending data.
- Provider tokens and secrets stay in server memory/environment; user-facing errors contain correlation IDs rather than provider bodies or stack traces.

## Unknown outcome

Inspect attempt ID, request UUID, dispatch timestamp, and any known refund ID. Use Refresh verified status. A known refund ID is reconciled by GET with capture/amount verification. If the POST response could not be parsed, an owned order GET can supply one candidate refund ID. Recovery requires exactly one order refund, a separate refund GET, the exact capture association/amount/currency, matching merchant/order identity, and a refund creation time at or after the original dispatch. The existing attempt is then reconciled and an explicit GET-recovery audit event is recorded. A refunded capture alone is insufficient; absent, multiple, old, or mismatched refund records remain unknown. Recovery verifies that the approved capture was refunded; it does not independently prove which actor caused the provider write. Never delete the reservation, reset DISPATCHING, or resend the write.

## Worker recovery

Jobs are claimed using FOR UPDATE SKIP LOCKED and a lease. Expired leases can be reclaimed. A DISPATCHING attempt older than 60 seconds becomes OUTCOME_UNKNOWN; reclaiming its job never grants permission for a second POST. Read-only jobs retry at most three handler attempts with delay. Known pending refunds schedule bounded individual GET jobs, preserving the local attempt.

## Source or policy changes

New source versions supersede reviewed rules. Rule/case/policy changes invalidate the fingerprint or eligibility. Historical approvals and audits remain. Review and approve a new proposal before dispatch; after dispatch, source changes do not erase the financial history.

## Practical limits

This is a local hackathon prototype. Database admins can alter infrastructure; append-only application evidence is not tamper-proof certification. The disposable local database identity owns tables; split migration and application roles before hosting. Expired public workspaces are denied access and excluded from capacity checks; a physical data-purge job is not implemented. Login quotas are per email; a reverse-proxy global/IP limiter is a hosting prerequisite. No audit export is sent externally.

There is no webhook endpoint. Signed webhook verification, inbox deduplication, Studio, production OAuth, real money, partial refunds, tax apportionment, and bulk refund tooling are outside the implemented release. Browser accessibility checks do not establish full accessibility certification.
