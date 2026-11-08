# Build status — November 8, 2026

## Current owner workflow check

The persistent owner workspace is created and sign-in works. CPSC source retrieval succeeds. Notice extraction now excludes unrelated recalls and footer text while retaining the PB003/PB0003 caption conflict and the labeled recall facts.

Gemini rejected two requests, then produced a candidate whose evidence joined noncontiguous source passages with invented ellipses. Validation correctly blocked that candidate. The revised grounded-v3 prompt passed a live extraction after the quota reset, on November 8 at 14:20 IST. Source `8b1cc5d8-fd7b-4cdd-9727-1ddc3bd158f8` was rechecked as CURRENT. Extraction `af62ffcf-20bd-4743-9558-4b09881085df` used Gemini `gemini-3.1-flash-lite`, returned response `1jfwasuzDZ3ag8UPktiz-Qw`, and passed a second server validation with zero errors. It preserved constrained MMA008/BPB002 scope, exact PB0003 all-serial scope, both refund/store-credit remedies, and the PB003 caption conflict. No quota was bypassed. The redacted owner check is in `docs/reports/owner-workflow.json`.

The owner deliberately approved rule r2 at 14:23 IST and the immutable USD 49.00 courtesy-refund proposal at 14:29 IST. Attempt `d08c2d25-679b-4ea1-9787-a314fe325e14` dispatched once. PayPal completed refund `30A36118AL831244C` for capture `07F32503KM161910G`. The initial response-link parser rejected the actual `api.sandbox.paypal.com` hostname, leaving the local attempt OUTCOME_UNKNOWN. The fix accepts only PayPal's two sandbox link origins while keeping every network request on the fixed `api-m.sandbox.paypal.com` base.

Read-only order/capture/refund GETs verified the completed USD 49.00 refund. The owned order supplied exactly one refund ID; recovery verified its association, amount, currency, merchant/order identity, and creation time after dispatch, then updated the original attempt to COMPLETED. The audit records `REFUND_DISCOVERED_BY_GET`. No new refund POST was sent. Re-submitting the approval returned the same attempt; SQL confirmed one attempt, one dispatch event, and one refund execution job. The saved proof is `docs/reports/sandbox-workflow-completed.json`; the receipt is `docs/reports/RR-001-sandbox-receipt.json`. Proof records identify the recovery method and `UNTAGGED_LOCAL_BUILD`. A verified refund association does not independently establish the provider-write actor.

Source rechecks now coalesce queued extraction jobs. Concurrent extraction workers share one durable reservation and reuse an already validated result. Verification scripts wait for the worker instead of issuing duplicate model calls. The UI labels rejected candidates, shows quota reset time, and refreshes while a job is active.

PayPal sandbox created order `0XG13462MH668510N`. Buyer checkout first failed with an India Sandbox Personal buyer. After switching to the United States sandbox buyer, purchase capture succeeded November 8 at 13:45 IST. The owned capture and matching merchant/internal order identity are saved. The latest authoritative provider check reports the capture REFUNDED and the corresponding USD 49.00 refund COMPLETED.

The setup screen originally retained its checkout button after capture. It now loads the persisted purchase status, removes checkout for a verified completed/refunded capture, and displays order/capture IDs and a link to source review. A regression test verifies that a page reload restores capture completion and does not load the PayPal SDK. “Refund proof not recorded yet” distinguishes the future refund proof from the saved purchase.

Current checks: 111 unit/component tests and 26 PostgreSQL integration tests pass, including extraction reservation/diagnostic checks, sandbox-link allowlist validation, read-only recovery, wrong-refund rejection, and duplicate protection. All six browser workflow tests passed against the repaired production app. Typecheck, lint, and the Node 22.14 Docker production build pass. Automated payment tests use mocked/fixture providers; actual sandbox purchase/refund proof is separately verified above.

The actual source → AI → human review → sandbox capture/refund → repeated-request verification flow is now exercised. A UI/UX refresh now covers both the public landing page and the merchant workbench: modern warm/green styling, larger text, order search, four default table columns, optional extra filters, plain-language source review, mobile navigation, and expandable long evidence/technical detail. `docs/UI_DESIGN.md` records the design scope and verification. The owner authorized source publication to `Sarvesh5273/RecallReady---PayPal-Hackathon` and approved MIT licensing on November 8, 2026. The source release is prepared as grouped commits with their actual creation dates. Next work: clean-checkout reviewer setup verification, final demo recording, and Devpost submission. No demo video or Devpost entry has been produced.

The sections below preserve the earlier build history; their initial absent-key and test-count observations are superseded by this current check.

## AI integration update

The owner authorized Groq, then Gemini, and saved credentials locally without displaying them. PayPal sandbox OAuth authentication has now succeeded; this does not prove merchant identity, buyer approval, capture, or refund completion.

Groq authenticated but returned schema-incomplete candidates and incorrect serial-scope facts. These were rejected. Gemini's key authenticated; several model requests timed out or returned 503. `gemini-3.1-flash-lite` successfully returned a candidate satisfying the original schema, exact source quotes, serial-scope checks, and caption/body conflict validation. The provider's schema literal was changed to a supported single-value enum; the server still rejects any schemaVersion other than `1`.

Actual Gemini provider/model/response metadata and validated source-grounded output are recorded in `docs/reports/live-extraction-candidate.json` and `docs/reports/extraction.json`. This proves one live model extraction on the cached official notice, not broad model accuracy. No real-money or PayPal purchase/refund was issued during this verification. The remaining live flow requires owner setup, source recheck/review, buyer approval, and deliberate refund approval.

The live CPSC → Gemini → PostgreSQL service workflow also passed in an isolated synthetic test workspace. `docs/reports/live-source-workflow.json` records `CPSC_LIVE`, provider `GEMINI`, model `gemini-3.1-flash-lite`, actual response ID, zero validation errors, constrained MMA008/BPB002 scope, PB0003 all-serial scope, and one caption/body conflict. No human rule review or payment write was performed.

The expanded provider boundary suite contains 93 unit/component checks; 21 PostgreSQL payment safety tests pass. Current setup uses Gemini by default when its key is configured and no explicit AI_PROVIDER is set. Keys were never displayed or inspected in chat.

## Implemented locally

Next.js/React/TypeScript/Tailwind workbench, AG Grid Community, four main destinations, desktop/mobile case evidence, source/rule review, inline deliberate approval, receipt export, guided scenario, activity, owner setup, sessions/roles/CSRF, and isolated reviewer workspaces.

PostgreSQL migrations preserve source/rule/proposal/approval records, enforce one capture reservation, protect audit history, and prevent dispatch reset/final downgrade. The durable worker verifies current permission before and after provider reads, writes only after reservation/dispatch, and reconciles uncertain or pending outcomes without a second POST.

CPSC REST/HTML and OpenAI Responses extraction adapters, real PayPal sandbox create/approve/capture/refund/GET adapters, server-owned payment mapping, and a read-only recorded-evidence command are implemented. Genuine model and sandbox payment execution have not been performed.

## Observed verification

| Command / evidence                    | Observed result                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm test`                            | 70 unit/component checks passed                                                                                    |
| `npm run test:integration`            | 21 checks passed against actual PostgreSQL 16; provider writes mocked                                              |
| `npm run test:e2e`                    | 6 browser checks passed: simulated receipt/repeat, refusals, timeout, isolation/amount rejection, mobile, keyboard |
| `npm run eval:matching`               | 24/24 deterministic match outcomes                                                                                 |
| `npm run eval:extraction`             | 4 fixture validator checks; zero model calls                                                                       |
| `npm run source:verify -- --save-raw` | Actual CPSC REST and HTML fetched; displayed date 2025-11-13, PB003/PB0003 conflict preserved                      |
| `npm run typecheck`                   | Passed                                                                                                             |
| `npm run lint`                        | Passed with no warnings at final check                                                                             |
| `npm run build`                       | Production build passed                                                                                            |
| Dependency installation/audit         | Zero reported npm advisories after patching the lint glob dependency                                               |
| `npm run demo:verify`                 | Database migrations present; sandbox guard enabled; PayPal/OpenAI keys absent; zero provider writes                |
| Visual inspection                     | Desktop workbench and full-width mobile case screenshots captured and inspected                                    |

Source retrieval evidence and its actual timestamp/hash are in `reports/source-live.json`; raw material is in `fixtures/sources/cpsc-live-snapshot.json`. The simulation's cached source does not count as a live workspace freshness check.

The local host was running Node 25.4.0 during initial verification. The final Docker build succeeded on Node 22.14.0. Inside the container, 70 unit/component checks passed with NODE_ENV=test and 21 safety checks passed against PostgreSQL 16.6. All six browser workflows also passed against the containerized production app.

Docker's first image export failed when the host disk filled. The owner authorized deleting Amazon_ML; that project and npm's disposable cache were removed. Docker was recovered without deleting volumes. The retry successfully compiled and exported the application image on Node 22.14.0. The host had approximately 22 GB free immediately after cleanup.

After recovery, the existing PostgreSQL volume contained 528 case rows and 8 simulated attempts. No Docker volume was removed. The outage exposed an unhandled idle-pool error; the connection handler now logs a redacted failure and reconnects for subsequent work. Compose services restart unless explicitly stopped.

Final local services: app at http://localhost:3000, worker, and PostgreSQL at 127.0.0.1:54329. Approximately 17 GB was free after rebuilding. A local database recovery backup was saved at `/private/tmp/recallready-recovery.sql`; it contains synthetic local session/workflow data and is not a public artifact.

## Historical owner gates from the initial build

These initial gates have since been completed; see the current verification above.

1. Add server-side PayPal sandbox client ID/secret/expected merchant ID and OpenAI key. Keep them out of chat and Git.
2. Create owner credentials interactively and approve the actual sandbox purchase using a separate buyer.
3. Recheck the official source, review the real extraction, and explicitly approve the courtesy refund in the same running app.
4. Verify the actual completed refund and save a provider-backed receipt. Until then, Milestone C's real proof gate is incomplete.

## Deferred / not claimed

AG Studio, signed webhooks, live model evaluation, actual payment proof, merchant interviews, comprehension study, measured workflow savings, public reviewer hosting, public repository/license grant, release tag, Devpost submission, and the final demo video. License publication and public deployment require separate owner authorization under the build contract.

The work is a functioning bounded local prototype, not a production-readiness claim or a completed hackathon submission.
