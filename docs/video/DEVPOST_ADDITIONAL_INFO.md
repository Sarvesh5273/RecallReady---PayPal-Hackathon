# Devpost additional information — paste-ready draft

Personal fields remain the submitter’s declarations and preferences. This file does not record agreement or submit a form.

## Upload a File

Optional prepared ZIP: `recordings/submission/RecallReady-test-build.zip` (1,465,132 bytes). This is the public source archive at commit `82d27495dfe506b189e30bdfe59f0493d9c29e73`, with source, MIT license, setup instructions and verified sandbox proof. It excludes private environment credentials, database data and local video footage.

## Submitter Type

Individual, if entering as the sole participant. Select Team or Organization if that reflects the actual entry.

## Country / Canada province / organization

Country: India, as supplied in the conversation. Canada province: N/A, if no team member resides in Canada. Organization name: N/A, if not representing an organization.

## New or Existing

New. Project implementation began during the submission period in November 2026, based on the project build history. Existing-project explanation: N/A.

## Main technology requirement

RecallReady integrates PayPal Checkout in the sandbox, using the JavaScript SDK for buyer approval, Orders API v2 for server-created orders and capture, and Payments API v2 for capture checks, courtesy refunds, and refund status verification. PayPal is the execution layer for the merchant’s approved financial decision. The server binds the exact amount, owned capture, and evidence versions to an immutable proposal. A dedicated worker rechecks eligibility before dispatch and verifies the returned refund through PayPal GET records. Repeated execution returns the existing attempt. The recorded flow completed a buyer-approved purchase and separately approved USD 49.00 sandbox refund; after repeated execution, the ledger retained one attempt, one dispatch, and one execution job.

Gemini, using gemini-3.1-flash-lite, extracts model identifiers, serial conditions, remedy instructions, and supporting quotes from a versioned official CPSC notice. Server validation checks the output against that snapshot and preserves source conflicts, including PB0003 versus PB003. A human reviews the exact rule before deterministic order matching. AI output cannot authorize a payment. The recording demonstrates actual source retrieval, Gemini extraction, and PayPal sandbox transactions; the public simulation is clearly labeled separately.

## Additional sponsor tools

AG Grid. AG Grid Community is implemented. No claim is made for AG Charts, AG Studio, or other listed sponsor tools.

## Public code repository

https://github.com/Sarvesh5273/RecallReady---PayPal-Hackathon

## Working demo / test build URL

https://github.com/Sarvesh5273/RecallReady---PayPal-Hackathon/archive/82d27495dfe506b189e30bdfe59f0493d9c29e73.zip

The official rules permit reviewer access through complete repository setup/run instructions; this field points to the verified public downloadable source build. This is not a hosted app URL.

## Testing instructions

Download and unzip the test build, or clone the public repository. Docker Desktop must be running. In the extracted project folder, run:

```sh
cp .env.example .env
docker compose up --build -d
```

Open http://localhost:3000 and click Open isolated simulation. No account, API keys, or payment credentials are needed for this reviewer mode. Keep all three Compose services running.

1. Inspect RR-001: exact PB0003 match with source evidence and merchant courtesy policy.
2. Inspect RR-002 and RR-003: different model and missing model; financial controls are disabled.
3. Return to RR-001, review and confirm the USD 49.00 simulated courtesy refund, and wait for completion.
4. Re-submit the approval: the same attempt returns. Inspect or download the labeled simulation receipt.
5. Optional: Guided walkthrough → RR-021 demonstrates an uncertain simulated result and reconciliation.

The simulation uses 24 synthetic orders and fixture provider behavior; it does not call live AI or PayPal. The video and docs/reports/submission-recording-sandbox-proof.json document the separately exercised real sandbox workflow. To exercise the live path yourself, follow docs/SETUP.md with your own PayPal sandbox app/buyer and Gemini credentials; keep these private.

## PayPal experience rating

User selection required. Do not choose a rating on the submitter’s behalf.

## PayPal experience feedback

The separation between orders, captures, and refunds supported a clear server-side payment workflow. Authoritative status reads were especially useful for verifying outcomes and recovering an uncertain response without another refund request. The main friction was sandbox setup: an India Sandbox Personal buyer failed for our test checkout, while a US sandbox buyer succeeded. We also encountered a sandbox link hostname variation that initially caused our strict response parser to reject a valid result. More prominent guidance on sandbox buyer compatibility and consistent response-link examples would improve onboarding. Building this integration taught us to distinguish buyer approval, capture completion, refund acceptance, and verified refund status.

## Contact permission

User preference required: Yes only if willing to be contacted.

## APIMatic Context Plugin experience

N/A — the APIMatic Context Plugin was not used.

## AG Grid experience

We used AG Grid Community with React and TypeScript to investigate order evidence. Sorting, column filters, custom cell renderers, and case selection helped us present model identifiers, match outcomes, and payment states together. We kept four default columns and made extra filters/details optional to reduce initial complexity. The main design challenge was balancing a dense desktop investigation table with readable evidence and clear financial controls; mobile users receive dedicated case details. We used AG Grid Community only, not AG Charts or AG Studio.

## Eligibility declarations

The submitter must personally confirm each statement about age of majority, jurisdiction eligibility, and absence of excluded employment/representation relationships. No declaration is inferred or accepted by this draft.

## AI tools used while working on the project

Gemini (gemini-3.1-flash-lite) performs structured recall extraction in the application. Codex assisted with implementation, debugging, testing, UI refinement, and demo production. ElevenLabs generated the demo narration, which was supplied by the owner and synchronized with actual app footage; it is not part of the application runtime. Groq was evaluated early during development before Gemini became the verified extraction provider. The recorded app uses Gemini, with no silent provider fallback.

## Learning level and career value

User selections required. Significant learning is consistent with the demonstrated work if it reflects the submitter’s experience. Career value: Yes only if that is the submitter’s own assessment.
