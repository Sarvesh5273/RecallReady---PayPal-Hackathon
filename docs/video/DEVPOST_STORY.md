## Inspiration

**Three orders. One recall. Three different decisions.**

That is the problem we built RecallReady around. Imagine a small online seller reviewing three power bank orders: the same brand, similar product titles, but different evidence. One has the recalled model, one has a different model, and one has no model identifier. A refund decision has to account for those differences.

The seller needs to connect the official notice to the order, understand the manufacturer’s instructions, and decide whether their own business should offer a courtesy refund. RecallReady brings that investigation and decision into one workbench.

Our guiding question was: **How can AI help someone make a financial decision while keeping the evidence and authority to act explicit?**

## What it does

RecallReady helps **small online sellers and support teams** review recall evidence, identify affected orders, and approve PayPal courtesy refunds with a traceable result.

The workflow has five steps:

1. **Read the official source.** Retrieve a CPSC recall notice and preserve a versioned snapshot.
2. **Extract supported facts.** Gemini returns model details, serial conditions, remedy instructions, supporting quotes, and source conflicts. The server validates the candidate against the saved source.
3. **Review the exact scope.** An operator checks the evidence and approves the product rule. Deterministic matching then separates confirmed matches, different models, and cases needing more evidence.
4. **Make the merchant decision.** A separate courtesy policy checks payment eligibility. The operator reviews an immutable proposal containing the exact amount, capture, and evidence versions before approving a refund.
5. **Verify the outcome.** A durable worker rechecks the prerequisites, sends the PayPal sandbox refund, and reads PayPal’s refund record to verify its association, amount, and status. The case retains a receipt and audit trail.

The manufacturer’s remedy remains a separate follow-up. A seller’s courtesy refund does not complete a manufacturer recall claim.

## Why the details matter

The real notice used in our demo contains a useful complication: its description names **PB0003**, while a caption says **PB003**. RecallReady preserves that discrepancy for human review. The caption does not silently become an approved alias.

The same principle applies to money. If the payment outcome is uncertain, the case keeps that uncertainty and offers reconciliation. Repeating an approved request returns its existing attempt instead of authorizing another refund.

For the seller, the intended benefit is a clear answer to three questions: **Which order matches? What evidence supports that decision? What happened to the payment?**

## How we built it

We built the application with **Next.js, React, and TypeScript**, backed by **PostgreSQL** and a dedicated Node.js worker. Docker Compose runs the app, worker, and database.

**Gemini** performs structured recall extraction. Source quotes, document hashes, and evidence validation connect its output to the notice. The reviewed rule drives deterministic order matching; model-generated text cannot authorize a payment.

**PayPal is central to the financial workflow:** server-created sandbox orders, buyer approval, capture verification, refund preflight, refund execution, and authoritative status reads. The refund amount comes from the approved server-side proposal; the browser cannot choose a replacement amount. PostgreSQL preserves the approved basis and execution reservation across repeated requests.

**AG Grid Community** powers order investigation through search, sorting, filters, and case selection. We designed the interface around the next action, kept source evidence beside the desktop refund review, and added mobile case details and keyboard-accessible controls.

Codex helped translate the implementation contract into code, investigate integration failures, run verification, and refine the interface. The owner performed the buyer, source-rule, and refund approvals. ElevenLabs supplied the demo narration, which we synchronized with actual application footage and bottom subtitles.

## Challenges we faced

- **Grounding the AI output:** an early candidate joined separate source passages with invented ellipses. Validation rejected it. We revised the extraction prompt and obtained a candidate that passed with the source conflict preserved.
- **Recovering a real payment outcome:** an early sandbox refund response contained a PayPal link hostname our parser rejected. The app retained the existing attempt as unknown. We corrected the sandbox allowlist and recovered the completed result through provider reads without sending another refund.
- **Making the review usable:** long evidence initially pushed approval too far down the page. We brought evidence and action side by side on desktop, anchored navigation, and checked the controls at desktop and phone sizes.

## Accomplishments and what we learned

Our recorded workflow used a live CPSC source, validated Gemini extraction, human-reviewed rule, buyer-approved sandbox purchase, and a separately approved **USD 49.00 refund**. PayPal reads verified the refund as completed. After two repeated execution requests, the database still held **one attempt, one dispatch event, and one execution job**.

Local verification passed **111 unit/component tests, 26 PostgreSQL integration tests with mocked providers, and six browser workflows**. The genuine sandbox result is documented separately in the public repository.

We learned that an AI-assisted payment experience depends on the handoffs: source to facts, facts to a reviewed rule, and approval to a verified provider result. Each handoff needs evidence the next step can check.

## What’s next

The current prototype uses synthetic orders, a bounded PB0003 rule, and PayPal sandbox funds. Our next step is to test the workflow with small sellers and support operators, measure investigation time and review comprehension, and use those findings to prioritize broader recall coverage and order-system integrations.

**RecallReady: the right order, the right evidence, your decision.**
