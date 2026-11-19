"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import "../../styles/operations-shell.css";

type Workspace = "staff" | "kitchen" | "menu" | "customers" | "printer";
export function OperationsShell({ active, training = false, children }: { active: Workspace; training?: boolean; children: ReactNode }) {
  const links: { key: Workspace; href: string; label: string }[] = [
    { key: "staff", href: "/staff/", label: "Delivery desk" },
    { key: "kitchen", href: "/kitchen/", label: "Kitchen" },
    { key: "customers", href: "/staff/customers/", label: "Customers" },
    { key: "menu", href: "/staff/menu/", label: "Menu editor" },
    { key: "printer", href: "/staff/printer-guide/", label: "Printer setup" },
  ];
  return <div className="ops-app">
    <a className="ops-skip-link" href="#main-content">Skip to workspace</a>
    <header className="ops-header restaurant-header">
      <Link href="/" className="ops-brand" aria-label="Wok and Chop home">
        <img src="/images/brand/wok-and-chop-horizontal-white.png" alt="" width="145" height="48" />
      </Link>
      <nav aria-label="Restaurant workspace">{links.map(link => <Link key={link.key} href={link.href} aria-current={!training && active === link.key ? "page" : undefined}>{link.label}</Link>)}</nav>
      <span className="ops-location">Kanata, Ontario</span>
    </header>
    {training && <div className="ops-training-links"><strong>Training workspace</strong>
      <Link href="/staff/training/" aria-current={active === "staff" ? "page" : undefined}>Practice order board</Link>
      <Link href="/kitchen/training/" aria-current={active === "kitchen" ? "page" : undefined}>Practice kitchen</Link>
      <span>Synthetic tickets</span>
    </div>}
    {children}
    <footer className="ops-footer restaurant-footer"><span>Wok &amp; Chop · Kanata</span>
      <nav aria-label="Workspace tools"><Link href="/staff/training/">Training board</Link><Link href="/kitchen/training/">Training kitchen</Link><Link href="/staff/printer-guide/">Printer guide</Link><Link href="/menu/">Customer menu ↗</Link></nav>
    </footer>
  </div>;
}
