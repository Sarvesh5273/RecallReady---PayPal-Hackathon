import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ShieldCheck,
  LayoutDashboard,
  BookOpen,
  Activity,
  Settings2,
  ArrowUpRight,
  Layers3,
} from "lucide-react";
import { currentActor } from "@/lib/auth/session";
import { EnvironmentBadge } from "./environment-badge";
export async function Shell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: string;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const nav = [
    { href: "/workbench", label: "Workbench", icon: LayoutDashboard },
    { href: "/sources", label: "Source & rules", icon: BookOpen },
    { href: "/activity", label: "Activity", icon: Activity },
    { href: "/demo/setup", label: "Demo setup", icon: Settings2 },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/workbench">
          <span className="brand-icon">
            <Layers3 size={26} />
          </span>
          RecallReady
        </Link>
        <div className="workspace-card">
          <span className="workspace-avatar">H</span>
          <div>
            <strong>Harbor Demo Goods</strong>
            <small>Synthetic merchant</small>
          </div>
        </div>
        <p className="nav-caption">INVESTIGATION</p>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              className={active === n.label ? "nav-link active" : "nav-link"}
              href={n.href}
              aria-current={active === n.label ? "page" : undefined}
              key={n.href}
            >
              <n.icon size={18} />
              {n.label}
              {active === n.label && <span className="nav-indicator" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="boundary-note">
            <ShieldCheck size={18} />
            <strong>Your team stays in control.</strong>
            <p>
              AI reads the notice. You review the evidence and approve the
              refund.
            </p>
          </div>
          <Link href="/product" className="quiet-link">
            About RecallReady <ArrowUpRight size={14} />
          </Link>
          <small className="footer-version">RecallReady · Prototype v0.1</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Harbor Demo Goods <span>/</span> {active}
          </span>
          <div className="topbar-right">
            <EnvironmentBadge mode={actor.mode} />
            <span className="operator-avatar" title={actor.role}>
              HD
            </span>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {nav.map((n) => (
            <Link
              href={n.href}
              key={n.href}
              aria-current={active === n.label ? "page" : undefined}
            >
              <n.icon size={18} />
              <span>
                {n.label === "Source & rules"
                  ? "Notice"
                  : n.label === "Demo setup"
                    ? "Setup"
                    : n.label}
              </span>
            </Link>
          ))}
        </nav>
        <main>{children}</main>
        <footer className="app-footer">
          Synthetic orders · Official CPSC notice ·{" "}
          {actor.mode === "SIMULATION"
            ? "Simulated payments"
            : "PayPal sandbox only"}
          <span>Manufacturer claims remain separate.</span>
        </footer>
      </div>
    </div>
  );
}
