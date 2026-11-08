"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "./client-api";
type Config = {
  mode: string;
  paypalReady: boolean;
  aiReady: boolean;
  aiProvider: string;
  aiModel: string | null;
  clientId: string | null;
  purchase: {
    provider_order_id: string | null;
    capture_id: string | null;
    verified_state: string;
    owned: boolean;
    amount_minor: string;
    currency: string;
    verified_at: string | null;
  } | null;
};
declare global {
  interface Window {
    paypal?: {
      Buttons: (options: {
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError: (error: unknown) => void;
        onCancel: () => void;
      }) => {
        render: (element: HTMLElement) => Promise<void>;
        close: () => void;
      };
    };
  }
}
export function DemoSetup() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [evidence, setEvidence] = useState<
      {
        mode: string;
        recorded_at: string;
        build_commit: string;
        evidence: unknown;
      }[]
    >([]);
  const checkout = useRef<HTMLDivElement>(null);
  const paymentComplete = !!(
    config?.purchase?.owned &&
    config.purchase.capture_id &&
    ["COMPLETED", "REFUNDED"].includes(config.purchase.verified_state)
  );
  const setupBlocked =
    !!config?.purchase &&
    config.purchase.verified_state !== "ORDER_CREATED" &&
    !paymentComplete;
  useEffect(() => {
    api<Config>("demo/setup/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
    api<typeof evidence>("demo/evidence")
      .then(setEvidence)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (
      !config?.clientId ||
      !config.paypalReady ||
      !checkout.current ||
      paymentComplete ||
      setupBlocked
    )
      return;
    let disposed = false;
    let buttons:
      | { render: (element: HTMLElement) => Promise<void>; close: () => void }
      | undefined;
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=USD&intent=capture&buyer-country=US&disable-funding=card,credit,paylater`;
    script.async = true;
    script.onload = () => {
      if (disposed || !window.paypal || !checkout.current) return;
      buttons = window.paypal.Buttons({
        createOrder: async () => {
          setError("");
          setMessage("Opening sandbox buyer checkout for USD 49.00.");
          const r = await api<{ orderId: string }>("demo/setup/order", {});
          return r.orderId;
        },
        onApprove: async (data) => {
          setMessage(
            "Buyer approved. The server is capturing and verifying this sandbox payment.",
          );
          const r = await api<{ status: string }>("demo/setup/capture", {
            orderId: data.orderID,
          });
          setConfig(await api<Config>("demo/setup/config"));
          setMessage("Sandbox capture verified: " + r.status + ".");
        },
        onError: () => {
          setMessage("");
          setError(
            "PayPal checkout did not complete. Use a United States Sandbox Personal buyer. The saved order is preserved; payment capture must be verified before any refund.",
          );
        },
        onCancel: () => {
          setMessage(
            "Buyer checkout closed. No verified capture was returned.",
          );
        },
      });
      buttons.render(checkout.current).catch(() => {
        if (!disposed) setError("PayPal buyer approval UI is unavailable.");
      });
    };
    script.onerror = () =>
      setError(
        "PayPal checkout could not load. Refresh this page and check that your browser permits PayPal's sandbox popup.",
      );
    document.body.appendChild(script);
    return () => {
      disposed = true;
      buttons?.close();
      script.remove();
    };
  }, [config, paymentComplete, setupBlocked]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">DEMO SETUP</p>
          <h1>Sandbox setup & saved proof.</h1>
          <p>
            Check your connections, complete a test purchase, and inspect the
            saved result.
          </p>
        </div>
        <button
          className="secondary"
          onClick={async () => {
            try {
              await api("session/logout", {});
              router.push("/");
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Sign out
        </button>
      </div>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="success-note">
          {message}
        </div>
      )}
      <div className="setup-grid">
        <section className="panel padded">
          <p className="eyebrow">CURRENT ENVIRONMENT</p>
          <h2>Integration readiness</h2>
          <div className="check-row">
            Workspace mode{" "}
            <span className="tag">{config?.mode ?? "Loading"}</span>
          </div>
          <div className="check-row">
            PayPal sandbox credentials{" "}
            <span
              className={"tag " + (config?.paypalReady ? "green" : "amber")}
            >
              {config?.paypalReady ? "Configured" : "Not configured"}
            </span>
          </div>
          <div className="check-row">
            {config?.aiProvider === "GEMINI"
              ? "Gemini"
              : config?.aiProvider === "GROQ"
                ? "Groq"
                : config?.aiProvider === "OPENAI"
                  ? "OpenAI"
                  : "AI"}{" "}
            extraction{" "}
            <span className={"tag " + (config?.aiReady ? "green" : "amber")}>
              {config?.aiReady ? "Configured" : "Not configured"}
            </span>
          </div>
          <p className="section-description">
            Only credential readiness is shown here. Configuration does not
            prove a successful payment or model request.
          </p>
        </section>
        <section className="panel padded">
          <p className="eyebrow">BUYER-APPROVED PURCHASE</p>
          <h2>RR-001 · USD 49.00</h2>
          <p className="section-description">
            The server fixes the order identity and price. A separate PayPal
            sandbox buyer approves the purchase. The server then verifies the
            captured payment and merchant identity.
          </p>
          {!paymentComplete && (
            <p className="match-box amber">
              For this demo, use a separate{" "}
              <strong>United States Sandbox Personal</strong> buyer from PayPal
              Developer → Testing Tools → Sandbox Accounts. This checkout uses
              US sandbox settings and test funds.
            </p>
          )}
          {!config ? (
            <p className="section-description">Checking the saved purchase…</p>
          ) : paymentComplete ? (
            <div className="match-box">
              <span className="tag green">
                {config.purchase!.verified_state === "REFUNDED"
                  ? "REFUNDED"
                  : "PAYMENT CAPTURED"}
              </span>
              <h3>
                {config.purchase!.verified_state === "REFUNDED"
                  ? "Sandbox purchase refunded"
                  : "Sandbox purchase completed"}
              </h3>
              <p>
                The server verified this USD 49.00 payment and its merchant.
                Your capture is saved.
              </p>
              <dl className="section-description">
                <dt>PayPal order</dt>
                <dd className="hash">{config.purchase!.provider_order_id}</dd>
                <dt>Capture</dt>
                <dd className="hash">{config.purchase!.capture_id}</dd>
              </dl>
              <Link className="primary full" href="/sources">
                Continue to source review
              </Link>
              <Link className="quiet-link" href="/workbench">
                Open workbench
              </Link>
              <p className="section-description">
                The courtesy refund requires a validated source, a reviewed
                rule, and your separate approval.
              </p>
            </div>
          ) : setupBlocked ? (
            <div role="status" className="match-box amber">
              The saved purchase is {config.purchase!.verified_state}.
              Verification is incomplete. Inspect this order before attempting
              another payment.
            </div>
          ) : config?.mode === "SIMULATION" ? (
            <div className="match-box amber">
              <p>
                This workspace uses simulated provider records. Create an owner
                sandbox workspace using the secure local owner setup command to
                test PayPal.
              </p>
            </div>
          ) : !config?.paypalReady ? (
            <div className="match-box amber">
              <p>
                Configure PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and
                PAYPAL_EXPECTED_MERCHANT_ID in the server environment, then
                restart the app and worker.
              </p>
            </div>
          ) : (
            <div ref={checkout} style={{ marginTop: 20 }} />
          )}
          {!paymentComplete && (
            <p className="section-description">
              Source freshness, rule review, merchant policy, and human refund
              approval remain separate prerequisites.
            </p>
          )}
        </section>
        <section className="panel padded">
          <p className="eyebrow">RECORDED SANDBOX EVIDENCE</p>
          <h2>
            {evidence.length
              ? "Read-only proof records"
              : "Refund proof not recorded yet"}
          </h2>
          <p className="section-description">
            Recorded evidence preserves a previous actual sandbox result and its
            build reference. It cannot be loaded as a new executable payment.
            {paymentComplete &&
              !evidence.length &&
              " Your purchase capture is saved above. Refund proof is recorded after the courtesy refund has been verified."}
          </p>
          {evidence.map((e, i) => (
            <div className="receipt-block" key={i}>
              <span className="tag">RECORDED SANDBOX EVIDENCE</span>
              <p>
                {e.recorded_at} · Build {e.build_commit}
              </p>
              <pre className="hash">{JSON.stringify(e.evidence, null, 2)}</pre>
            </div>
          ))}
        </section>
        <section className="panel padded">
          <p className="eyebrow">DEMONSTRATION CONTRACT</p>
          <h2>What the prototype proves</h2>
          <p className="section-description">
            One exact PB0003 match. A misleading PB0004 near-match. A missing
            model that requires review. An explicitly approved courtesy refund.
            A repeated execution request that returns the same durable attempt.
          </p>
          <p className="section-description">
            Synthetic people and orders. No manufacturer partnership or claim
            submission. No real money. Merchant demand and user comprehension
            remain unvalidated.
          </p>
        </section>
      </div>
    </>
  );
}
