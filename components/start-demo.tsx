"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Layers3,
  ArrowRight,
  Check,
  FileSearch,
  ScanSearch,
  ShieldCheck,
  ArrowUpRight,
  CircleCheck,
  CircleHelp,
  Ban,
  LockKeyhole,
  PackageCheck,
} from "lucide-react";
import { api } from "./client-api";
export function StartDemo({ signedIn = false }: { signedIn?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      await api("demo/simulation", {});
      router.push("/workbench");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="product-site">
      <a className="skip-link" href="#product-main">
        Skip to content
      </a>
      <header className="product-nav">
        <Link href="/product" className="brand">
          <Layers3 size={28} />
          RecallReady
        </Link>
        <nav aria-label="Product navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#built-for">Who it’s for</a>
          <a href="#demo">The demo</a>
        </nav>
        <Link className="secondary" href={signedIn ? "/workbench" : "/login"}>
          {signedIn ? "Open workbench" : "Log in"}
          <ArrowUpRight size={15} />
        </Link>
      </header>
      <main id="product-main" className="product-main">
        <section className="product-hero">
          <div className="hero-copy">
            <span className="audience-pill">
              For online sellers & support teams
            </span>
            <h1>
              A product recall.
              <br />A clear plan.
              <br />
              <span className="marker">You’re in control.</span>
            </h1>
            <p>
              Find the affected orders. Understand the evidence. Approve the
              right next step—all in one calm workbench.
            </p>
            <div className="hero-actions">
              {signedIn ? (
                <Link className="primary" href="/workbench">
                  Open your workbench
                  <ArrowRight size={18} />
                </Link>
              ) : (
                <button
                  className="primary"
                  onClick={start}
                  disabled={busy}
                  aria-label={
                    busy
                      ? "Preparing your workbench…"
                      : "Open isolated simulation"
                  }
                >
                  {busy ? "Preparing demo…" : "Try the interactive demo"}
                  <ArrowRight size={18} />
                </button>
              )}
              <a className="secondary" href="#how-it-works">
                See how it works
                <ArrowRight size={17} />
              </a>
            </div>
            <p className="hero-caption">
              <Check size={14} />
              Synthetic orders · Clearly labeled simulation · No signup for the
              demo
            </p>
            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
          </div>
          <div
            className="hero-visual"
            aria-label="Illustrative preview of the included demonstration"
          >
            <div className="hero-orbit" />
            <div className="preview-window">
              <div className="preview-top">
                <span className="preview-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <Layers3 size={14} />
                  RecallReady
                </span>
                <span className="preview-mode">DEMO PREVIEW</span>
              </div>
              <div className="preview-content">
                <div className="preview-heading">
                  <div>
                    <small>YOUR RECALL WORKBENCH</small>
                    <h2>Know what needs attention.</h2>
                  </div>
                  <span className="preview-check">
                    <ShieldCheck size={21} />
                  </span>
                </div>
                <div className="preview-notice">
                  <FileSearch size={24} />
                  <div>
                    <strong>Belkin power bank recall</strong>
                    <small>CPSC 26-090 · Exact model: PB0003</small>
                  </div>
                </div>
                <div className="preview-rows">
                  {[
                    {
                      id: "RR-001",
                      model: "PB0003",
                      label: "Confirmed match",
                      icon: CircleCheck,
                      color: "green",
                    },
                    {
                      id: "RR-002",
                      model: "PB0004",
                      label: "Not matched",
                      icon: Ban,
                      color: "muted",
                    },
                    {
                      id: "RR-003",
                      model: "Model missing",
                      label: "Needs review",
                      icon: CircleHelp,
                      color: "amber",
                    },
                  ].map((r) => (
                    <div className="preview-row" key={r.id}>
                      <span className={"preview-row-icon " + r.color}>
                        <r.icon size={18} />
                      </span>
                      <div>
                        <strong>{r.id}</strong>
                        <small>{r.model}</small>
                      </div>
                      <span className={"tag " + r.color}>{r.label}</span>
                    </div>
                  ))}
                </div>
                <div className="preview-decision">
                  <span>
                    <LockKeyhole size={16} />
                    Your approval controls the refund.
                  </span>
                  <ArrowRight size={17} />
                </div>
              </div>
            </div>
            <div className="proof-float">
              <span>
                <PackageCheck size={21} />
              </span>
              <div>
                <strong>Evidence before action.</strong>
                <small>A source for every decision.</small>
              </div>
            </div>
          </div>
        </section>
        <section className="product-benefits" aria-label="Core capabilities">
          {[
            { icon: FileSearch, text: "Start with an official notice" },
            { icon: ScanSearch, text: "Find exact & uncertain matches" },
            { icon: ShieldCheck, text: "Approve refunds deliberately" },
            { icon: LockKeyhole, text: "Keep an auditable record" },
          ].map((b) => (
            <div key={b.text}>
              <b.icon size={24} />
              <span>{b.text}</span>
            </div>
          ))}
        </section>
        <section id="how-it-works" className="how-section">
          <div className="section-intro">
            <p className="eyebrow">LESS GUESSWORK. MORE CLARITY.</p>
            <h2>
              Three steps.
              <br />
              One clear workbench.
            </h2>
            <p>
              AI helps read the notice. You review the evidence and decide what
              happens next.
            </p>
          </div>
          <div className="how-cards">
            {[
              {
                n: "01",
                icon: FileSearch,
                title: "Review the notice",
                text: "Read the official source and check the AI’s quoted facts. Resolve conflicting model details before using a rule.",
              },
              {
                n: "02",
                icon: ScanSearch,
                title: "Inspect your orders",
                text: "See confirmed matches, different models, and missing evidence. Each order explains why it belongs in its group.",
              },
              {
                n: "03",
                icon: ShieldCheck,
                title: "Approve the next step",
                text: "Review your own courtesy-refund policy and the exact amount. Keep the manufacturer’s remedy separate.",
              },
            ].map((s) => (
              <article key={s.n}>
                <div className="how-card-top">
                  <span>{s.n}</span>
                  <s.icon size={23} />
                </div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="built-for" className="audience-section">
          <div>
            <p className="eyebrow">BUILT FOR THE PEOPLE HANDLING THE ORDERS</p>
            <h2>
              For the seller.
              <br />
              For the support team.
              <br />
              <span>For the next clear decision.</span>
            </h2>
          </div>
          <div>
            <p>
              When a notice arrives, your team needs to know which orders
              match—and which need a closer look. RecallReady brings the source,
              product identifiers, and refund decision together.
            </p>
            <ul>
              <li>
                <Check size={18} />
                Sellers investigating products they sold
              </li>
              <li>
                <Check size={18} />
                Support teams reviewing uncertain cases
              </li>
              <li>
                <Check size={18} />
                Owners approving their own refund policy
              </li>
            </ul>
          </div>
        </section>
        <section id="demo" className="demo-invite">
          <div>
            <p className="eyebrow">EXPLORE THE WORKING PROTOTYPE</p>
            <h2>
              See the difference
              <br />
              one model number makes.
            </h2>
            <p>
              Explore 24 synthetic orders: one exact match, a misleading
              near-match, a missing model, and an explicitly approved courtesy
              refund.
            </p>
          </div>
          <div>
            <span className="demo-pill">
              PayPal sandbox + source-grounded AI
            </span>
            {signedIn ? (
              <Link className="primary" href="/workbench">
                Return to workbench
                <ArrowRight size={18} />
              </Link>
            ) : (
              <button className="primary" onClick={start} disabled={busy}>
                {busy ? "Preparing demo…" : "Explore 24 demo orders"}
                <ArrowRight size={18} />
              </button>
            )}
            <small>
              The public demo uses simulation. The owner workspace supports
              actual PayPal sandbox transactions.
            </small>
          </div>
        </section>
      </main>
      <footer className="product-footer">
        <Link className="brand" href="/product">
          <Layers3 size={24} />
          RecallReady
        </Link>
        <p>Hackathon prototype · Synthetic commerce · PayPal sandbox only</p>
        <span>No manufacturer claims are submitted.</span>
      </footer>
    </div>
  );
}
