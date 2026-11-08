# Setup and real sandbox gate

## Local simulation

The README's two-terminal setup is sufficient. PostgreSQL listens only on 127.0.0.1:54329; Next.js listens on port 3000. Both app and worker use the same DATABASE_URL. Simulation needs no provider credentials and never makes a payment/model call. Workspace/session expiry is eight hours. The demonstration uses a cached official notice and an explicitly labeled reviewed fixture rule.

The container configuration pins Node 22.14.0 and PostgreSQL 16.6. npm dependencies are exact and locked in package-lock.json. `.env` is ignored by Git and Docker.

## Owner and credentials

Enter credentials using the local environment file or the host's secure secret mechanism. Do not paste API secrets into chat, URLs, logs, or source code.

Configure these before creating a sandbox owner workspace:

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=<sandbox REST app client ID>
PAYPAL_CLIENT_SECRET=<sandbox REST app secret>
PAYPAL_EXPECTED_MERCHANT_ID=<sandbox business merchant ID>
AI_PROVIDER=gemini
GEMINI_API_KEY=<server key>
GEMINI_MODEL=gemini-3.1-flash-lite
```

The user authorized Gemini after Groq returned schema-incomplete or unsupported source facts. Gemini uses its documented generateContent JSON Schema output. Source-quote, exact identity, serial-scope, and conflict validation remain mandatory. If AI_PROVIDER is unset, a configured Gemini key selects Gemini; otherwise the explicit provider controls selection. Groq and OpenAI remain explicit alternatives. A provider failure never triggers fixture or alternate-provider fallback.

Run `npm run owner:create` in a local terminal. Supply an email, explicitly choose `PAYPAL_SANDBOX`, and enter a password of at least 12 characters. The password input is hidden and stored using scrypt with an individual random salt. No default owner password is seeded. Restart app and worker after changing environment variables.

## Actual sandbox flow

1. Sign in at `/login`.
2. In Demo setup, use the PayPal Buttons UI and a separate United States Sandbox Personal buyer to approve RR-001's USD 49.00 order. Find or create that buyer through PayPal Developer → Testing Tools → Sandbox Accounts; use its generated test email/password in sandbox checkout. The server creates the order with a fixed internal reference, captures it, and validates identity. The setup page restores the saved purchase after reload and removes checkout once the capture is verified.
3. In Source & rules, queue an official recheck. Refresh the view after the worker fetches both CPSC REST data and HTML. Successful new content creates an immutable version and queues the configured AI extraction.
4. Confirm that the extraction has real model/response metadata and validated source quotes. Write a contextual PB003/PB0003 discrepancy decision, select the review confirmation, and click Approve reviewed rule. Extraction is limited to five requests per workspace/hour; the source page shows the reset time if the quota is exhausted.
5. In Workbench, review RR-001's proposal, confirm the exact amount and independent merchant policy, and approve.
6. Wait for verified provider status. PENDING is not completed. Unknown stays unknown until an exact refund association is verified.
7. Re-submit the same approval to inspect the existing attempt.
8. Optionally record proof with `BUILD_COMMIT=<local commit> npm run demo:record -- --attempt <UUID>`.

Once an attempt exists, a new proposal cannot create a second attempt for that capture. A new real take requires a new owner workspace and a new buyer-approved order; never reset a refunded capture in PostgreSQL.

## Container hosting instructions

Public deployment requires owner authorization. For an authorized deployment, build the Docker image, use persistent PostgreSQL, and run separate app and worker services from the same build. Apply migrations with a separate migration identity; set APP_BASE_URL to the exact HTTPS origin and SESSION_COOKIE_SECURE=true. Use independently generated database credentials, backups, and provider secrets. Do not publish PostgreSQL or use the disposable local password.

Readiness must include the complete migration set. Run `demo:verify`, inspect a clean simulation, and keep the persistent worker running. Neither health endpoints nor deployment setup performs a refund. Hosted reviewer access, availability through judging, quota behavior, container image scanning, and release approval remain release gates.
