# Architecture

Browser → authenticated Next.js routes → PostgreSQL ledger/jobs → dedicated worker → fixed CPSC/Gemini-or-Groq-or-OpenAI/PayPal adapters.

## Modules

`lib/domain` contains pure identifier matching, integer money, canonical fingerprints, evidence resolution, merchant policy, and refund state mapping. `lib/services` coordinates database transactions and workspace scoping. `lib/adapters` implements providers; only server code imports credential-bearing adapters. Client components import money helpers and types, never provider credentials or financial services. `worker/handlers/refund.ts` owns dispatch and reconciliation.

The four destinations are Workbench, Source & rules, Activity, and Demo setup. AG Grid Community provides sorting, column filters, and case selection. Mobile case details use their own full-width route. Approval is an inline review section, so source evidence remains available.

## Financial sequence

1. Build a proposal using the stored single-item capture amount and current source/rule/policy/case data.
2. Save the recursive lexicographic canonical JSON and SHA-256. Arrays retain order; undefined, non-finite numbers, and non-JSON values are rejected.
3. Record an operator's deliberate confirmation and immutable approval. Default lifetime: ten minutes.
4. In a workspace-locked transaction, return an existing attempt first, or validate and insert one attempt, request UUID, job, and audit event.
5. Commit before provider access.
6. Worker verifies current approval, then GETs the provider order and capture.
7. Lock/revalidate again and compare-and-set DISPATCHING with its immutable timestamp.
8. Only the winning worker sends one refund POST with the persisted PayPal-Request-Id.
9. Persist the known refund ID, then GET and verify capture association, currency, amount, identity, and actual status.

If parsing the POST response fails, reconciliation can discover exactly one refund ID on the owned order. A separate GET validates its capture, amount, currency, and creation time against the existing dispatch before recording completion. Multiple or mismatched candidates remain unknown. This records provider-read recovery, preserves the same attempt, and sends no new refund POST. PayPal's `api.sandbox.paypal.com` and `api-m.sandbox.paypal.com` origins are accepted when parsing the capture association; all outbound requests still use only the fixed `api-m.sandbox.paypal.com` base.

Unique indexes enforce a lifetime local attempt per workspace/mode/capture, unique request UUID, unique known refund association, unique owned capture mapping, and one active policy. Database triggers prevent mutation of approval/proposal/source/rule content, dispatch reset, final-state downgrade, and audit updates/deletes. Workspace locks are intentionally coarse for the small prototype.

This is one durable local reservation with conservative reconciliation, not an exactly-once distributed execution claim. A dashboard refund by another actor is detected at preflight when observable, but cannot be made impossible by this application.

## Evidence sequence

CPSC recall-number search is filtered to one exact normalized record. Official-host requests enforce HTTPS, redirect checks, ten-second timeout, and one-megabyte bodies. Cheerio extracts article/main content and preserves image alt captions. Raw API data, HTML, normalized text, timestamps, and hashes persist in source versions. A failed recheck never stamps cached material as current.

The selected provider is stored on every extraction. Groq Chat Completions uses strict JSON Schema and the default `openai/gpt-oss-120b` model; explicit OpenAI mode uses Responses. Gemini uses generateContent with responseFormat JSON Schema and records its actual returned modelVersion and responseId. All providers produce the same versioned candidate shape, which is validated again with Zod. A cited quote must exist exactly once; the server computes UTF-16 offsets and document hashes. The bounded validator also requires factual values to retain source wording, so unsupported paraphrases fail closed. Promotion creates a new reviewed rule; it never executes arbitrary model-generated code. The supported demonstration rule is exact Belkin/PB0003 with model-specific all-serial evidence.

## Mode boundary

SIMULATION uses workspace-specific SIM_ identifiers and records synthetic provider calls. PAYPAL_SANDBOX uses only `api-m.sandbox.paypal.com`. Recorded proof is a separate read-only evidence table and cannot become an executable payment link. SQL and runtime checks prevent mode mismatches.
