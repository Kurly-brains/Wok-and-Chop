"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { accountSessionChange, API_URL } from "../../lib/customer-session";
import {
  staffSessionPath,
  staffSignInUrl,
  staffWorkspaces,
  type StaffWorkspace,
} from "../../lib/staff-routes";
import "../../styles/operations-shell.css";

type Workspace = StaffWorkspace | "sign-in";
type WorkspaceLink = { key: StaffWorkspace; label: string };

const linkGroups: { label: string; links: WorkspaceLink[] }[] = [
  {
    label: "Service",
    links: [
      { key: "overview", label: "Overview" },
      { key: "staff", label: "Order desk" },
      { key: "kitchen", label: "Kitchen display" },
      { key: "reservations", label: "Reservations" },
    ],
  },
  {
    label: "Management",
    links: [
      { key: "menu", label: "Menu editor" },
      { key: "customers", label: "Customers" },
      { key: "reports", label: "Reports" },
      { key: "marketing", label: "Marketing" },
      { key: "printer", label: "Printer setup" },
    ],
  },
];

export function OperationsShell({
  active,
  children,
}: {
  active: Workspace;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const navId = useId();
  const signIn = active === "sign-in";
  const currentLabel =
    linkGroups
      .flatMap((group) => group.links)
      .find((link) => link.key === active)?.label ?? "Staff sign-in";

  useEffect(() => {
    const frame = shell.current;
    if (!frame || active === "sign-in") return;
    const loginUrl = staffSignInUrl(active);
    let pending: AbortController | undefined;

    function suspend() {
      frame?.setAttribute("data-session-suspended", "");
    }

    function sessionChanged() {
      suspend();
      window.location.reload();
    }

    function checkSession() {
      pending?.abort();
      const request = new AbortController();
      pending = request;
      void fetch(`${API_URL}${staffSessionPath}`, {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(6000)]),
      })
        .then(
          async (response) =>
            response.ok && (await response.json()).authorized === true,
        )
        .catch(() => false)
        .then((authorized) => {
          if (request.signal.aborted) return;
          if (authorized) frame?.removeAttribute("data-session-suspended");
          else {
            suspend();
            window.location.replace(loginUrl);
          }
        });
    }

    function onStorage(event: StorageEvent) {
      if (event.key === accountSessionChange) sessionChanged();
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) checkSession();
    }

    window.addEventListener(accountSessionChange, sessionChanged);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", checkSession);
    const timer = window.setInterval(checkSession, 60_000);
    return () => {
      pending?.abort();
      window.removeEventListener(accountSessionChange, sessionChanged);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", checkSession);
      window.clearInterval(timer);
    };
  }, [active]);

  return (
    <div
      ref={shell}
      className={
        signIn ? "ops-app ops-admin" : "ops-app ops-admin ops-admin--workspace"
      }
    >
      <a className="ops-skip-link" href="#main-content">
        Skip to {signIn ? "sign-in" : "workspace"}
      </a>
      <header className="ops-admin-masthead">
        <div className="ops-admin-brand">
          <Link
            href={signIn ? "/" : staffWorkspaces.overview}
            prefetch={false}
            aria-label={
              signIn ? "Wok & Chop home" : "Wok & Chop staff overview"
            }
          >
            <img
              src={
                signIn
                  ? "/images/brand/wok-and-chop-horizontal-white.png"
                  : "/images/brand/wok-and-chop-horizontal.png"
              }
              alt=""
              width={145}
              height={48}
            />
          </Link>
          <span>{signIn ? "Staff access" : "Staff workspace"}</span>
        </div>
        <Link className="ops-admin-site-link" href="/">
          Customer site <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <div className={signIn ? "ops-admin-sign-in-frame" : "ops-admin-frame"}>
        {!signIn && (
          <div
            className="ops-admin-rail"
            onKeyDown={(event) => {
              if (event.key === "Escape" && menuOpen) {
                setMenuOpen(false);
                menuToggle.current?.focus();
              }
            }}
          >
            <button
              className="ops-admin-mobile-toggle"
              type="button"
              ref={menuToggle}
              aria-label={`Workspace menu, ${currentLabel}`}
              aria-expanded={menuOpen}
              aria-controls={navId}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span>{currentLabel}</span>
              <span className="ops-admin-menu-icon" aria-hidden="true" />
            </button>
            <nav
              className="ops-admin-nav"
              id={navId}
              data-open={menuOpen}
              aria-label="Restaurant workspace"
            >
              {linkGroups.map((group) => (
                <div key={group.label} className="ops-admin-nav-group">
                  <p>{group.label}</p>
                  {group.links.map((link) => (
                    <Link
                      key={link.key}
                      href={staffWorkspaces[link.key]}
                      prefetch={false}
                      aria-current={active === link.key ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        )}
        <div className="ops-admin-content">{children}</div>
      </div>
      <footer className="ops-admin-footer">
        Wok &amp; Chop · Kanata, Ontario
      </footer>
    </div>
  );
}
