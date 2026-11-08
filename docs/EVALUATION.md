# Evaluation

## Keep the measurements separate

The ledger fixture contains 24 expected deterministic match outcomes and separate initial financial eligibility/lifecycle expectations. Matching is not model intelligence. The same exact product can be blocked because its payment is unowned, pending, partially refunded, non-USD, an unsupported quantity, or bound to stale evidence.

- `npm run eval:matching`: records 24 match assertions in `reports/matching.json`.
- `npm run eval:extraction`: fixture validator/adversarial checks, zero model calls. `--live` explicitly invokes the configured AI provider and records the distinction.
- `npm test`: identifier/serial/date constraints, missing fields, evidence hashes/offsets, identity conflicts, canonical fingerprints, amount exclusions, pending state, SSRF host guards, and deliberate UI confirmation.
- `npm run test:integration`: real PostgreSQL and mocked provider behavior. Reservation concurrency, duplicate dispatch, crash recovery, accepted-write timeout, pending reconciliation, wrong association, external partial refund, stale approval, policy revocation, foreign workspace IDs, rollback, persistence, and SQL immutability.
- `npm run test:e2e`: browser simulation, near-match/missing-model refusal, unknown outcome, malicious amount rejection, tenant isolation, mobile details, and keyboard approval.
- `npm run source:verify`: actual official CPSC REST/page reads, no payment writes.

RR-018 injects a clearly synthetic source update after approval; RR-019 injects pre-dispatch revocation. RR-021 simulates acceptance followed by timeout. Concurrency and duplicate delivery are tested against real PostgreSQL, using fixture payment records. Out-of-order state behavior is tested without claiming a webhook integration.

## Observed genuine sandbox evidence

On November 8, 2026, the owner approved an actual sandbox purchase, reviewed the live Gemini extraction, and separately approved the USD 49.00 courtesy refund. PayPal GET confirmed order `0XG13462MH668510N`, capture `07F32503KM161910G` (REFUNDED), and refund `30A36118AL831244C` (COMPLETED for USD 49.00). A response-link hostname mismatch initially left the local attempt unknown; the fixed parser and conservative GET discovery recovered the existing refund without a new POST. Re-submitting approval returned the same attempt. `docs/reports/sandbox-workflow-completed.json` and `docs/reports/RR-001-sandbox-receipt.json` preserve the result and recovery method.

Current automated checks: 111 unit/component tests, 26 real PostgreSQL integration tests (mocked provider writes), and six browser tests pass. No broad AI accuracy claim follows from one validated live notice extraction.

## Remaining evidence

The E-03 actual sandbox purchase/refund proof is now saved. A broader live AI extraction evaluation, three independent comprehension walkthroughs, merchant interviews, measured workflow baseline, and a tagged release have not been completed. These must not be replaced by simulated IDs or by the matcher pass rate.

The testing reports and BUILD_STATUS record observed results. A configured key, a passing mock test, or a successful local build is not proof of an exercised live provider integration.
