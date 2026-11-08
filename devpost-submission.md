# RecallReady

## One-line Summary

Help small sellers review recall evidence with AI, match affected orders, and approve PayPal courtesy refunds with verified results and duplicate protection.

## Project Story

Paste the complete text from `docs/video/DEVPOST_STORY.md` into the supplied **About the project** field.

## Problem

Small sellers need to connect official recall scope to order identifiers and distinguish manufacturer remedy instructions from their own courtesy-refund authority.

## Solution

Versioned source → quote-validated Gemini facts → human-reviewed exact rule → deterministic order triage → separate courtesy-refund approval → provider-verified result and receipt.

## Why This Matters

The intended user benefit is a clear, traceable investigation and financial decision. Merchant demand, time savings, and review comprehension have not yet been measured.

## How We Used AI

Gemini performs structured source extraction. The server validates quoted evidence and retains model conflicts. Extraction cannot authorize a financial action. The live recording used Gemini `gemini-3.1-flash-lite` and the grounded-v3 prompt.

## How We Used Codex

Codex helped implement the contract, debug grounding and PayPal parsing problems, verify workflows, refine the UI, and capture/edit actual demo footage. The owner performed the human approval gates. ElevenLabs narration was generated manually by the owner and supplied for synchronization.

## Key Features

- Official-source snapshots and evidence validation.
- Human rule review and exact model matching.
- Searchable AG Grid merchant workbench.
- Independent merchant courtesy policy and immutable amount/capture proposal.
- Durable payment attempt, provider status verification, reconciliation, and repeat protection.
- Receipts, audit trail, responsive case details, and keyboard controls.

## Architecture

Next.js/React/TypeScript browser and API → PostgreSQL ledger/jobs → Node.js worker → CPSC, Gemini, and PayPal sandbox REST adapters.

## Built With

Suggested tags: `paypal`, `gemini`, `typescript`, `next.js`, `react`, `node.js`, `postgresql`, `ag-grid`, `docker`, `tailwindcss`, `zod`, `vitest`, `playwright`.

ElevenLabs is a demo-production tool, not an application dependency. It is described in the story rather than the application stack tags.

## Testing Instructions

Follow the public README. For the container path:

```sh
cp .env.example .env
docker compose up --build -d
```

Open `http://localhost:3000`, choose **Open isolated simulation**, inspect RR-001/RR-002/RR-003, approve the simulated exact-match courtesy refund, inspect the receipt, and repeat execution. The simulation needs no external payment or AI credentials. Live extraction and real sandbox payments require private provider setup and the owner's approval gates, documented in `docs/SETUP.md`.

## Public Demo Link

No hosted app URL supplied. Verified downloadable test build: https://github.com/Sarvesh5273/RecallReady---PayPal-Hackathon/archive/82d27495dfe506b189e30bdfe59f0493d9c29e73.zip . Reviewer access uses the included setup instructions. A fresh-database simulation passed; see docs/reports/reviewer-build-check.json.

## Public Repository Link

https://github.com/Sarvesh5273/RecallReady---PayPal-Hackathon

## Demo Video

Local narrated file: `recordings/submission/final/RecallReady-submission-demo-captioned.mp4`.

Verified runtime: 2:50, 1920×1080, 30 fps, with supplied narration and bottom captions. Actual human approvals retained; review/processing waits shortened. **TODO: add the uploaded YouTube URL.** No upload URL has been supplied in this conversation.

## Screenshot Shot List

Gallery order: product identity → official source/Gemini evidence → missing-model refusal → verified refund and repeated attempt. Prepared from actual captured app screens in `recordings/submission/gallery/`.

## Submission Readiness Notes

This is a local copy draft. Devpost connector authentication is expired; the user supplied the current form and is entering it manually. No form or final entry was changed by this drafting task. Registration and final submission status were not independently verified.

Public source and MIT license are already published. Genuine sandbox evidence: `docs/reports/submission-recording-sandbox-proof.json`. Local video media is excluded from Git.

## Known Limitations

Synthetic merchant/orders; sandbox funds; bounded exact PB0003 demonstration rule; USD single-item courtesy policy; manufacturer claim filing and customer notifications not implemented; merchant demand and broad model accuracy unvalidated.

## TODO Official Form Fields

- Paste the About story and Built with tags.
- Add repository URL and gallery images.
- Add the YouTube URL for the narrated demo.
- Review remaining event-specific form questions and testing instructions before the final entry action.

## Additional Information Form

Paste-ready technical/test-build answers and personal-field guidance are in `docs/video/DEVPOST_ADDITIONAL_INFO.md`. Optional source ZIP: `recordings/submission/RecallReady-test-build.zip` (under 35 MB). Personal ratings, contact permission, learning assessment and eligibility declarations remain for the submitter.
