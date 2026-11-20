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
type OrderSummary = { activeCount: number; newOrderIds: string[] };

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
  const [activeOrders, setActiveOrders] = useState<number | null>(null);
  const [newOrders, setNewOrders] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const navId = useId();
  const signIn = active === "sign-in";
  const currentLabel =
    linkGroups
      .flatMap((group) => group.links)
      .find((link) => link.key === active)?.label ?? "Staff sign-in";
  const orderCountLabel =
    activeOrders === 1 ? "1 active order" : `${activeOrders} active orders`;
  const arrivalMessage =
    newOrders === 1
      ? "1 new order received"
      : `${newOrders} new orders received`;

  useEffect(() => {
    if (signIn) return;
    let pending: AbortController | null = null;
    let previous: Set<string> | null = null;

    async function refreshOrders() {
      if (document.hidden || pending) return;
      const request = new AbortController();
      pending = request;
      try {
        const response = await fetch(
          `${API_URL}/v1/auth/admin/deliveries/summary/`,
          {
            credentials: "include",
            cache: "no-store",
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(8000),
            ]),
          },
        );
        if (request.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            previous = null;
            setNewOrders(0);
          }
          setActiveOrders(null);
          return;
        }
        const summary: OrderSummary = await response.json();
        if (request.signal.aborted) return;
        if (
          !Number.isSafeInteger(summary.activeCount) ||
          summary.activeCount < 0 ||
          !Array.isArray(summary.newOrderIds)
        ) {
          setActiveOrders(null);
          return;
        }
        const current = new Set(summary.newOrderIds);
        const prior = previous;
        if (prior) {
          const arrivals = [...current].filter((id) => !prior.has(id)).length;
          if (arrivals) setNewOrders((count) => count + arrivals);
        }
        previous = current;
        setActiveOrders(summary.activeCount);
      } catch {
        if (!request.signal.aborted) setActiveOrders(null);
      } finally {
        pending = null;
      }
    }

    void refreshOrders();
    const timer = window.setInterval(refreshOrders, 5000);
    document.addEventListener("visibilitychange", refreshOrders);
    window.addEventListener("focus", refreshOrders);
    return () => {
      pending?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOrders);
      window.removeEventListener("focus", refreshOrders);
    };
  }, [signIn]);

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
              aria-label={`Workspace menu, ${currentLabel}${activeOrders === null ? "" : `, ${orderCountLabel}`}`}
              aria-expanded={menuOpen}
              aria-controls={navId}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span>{currentLabel}</span>
              <span className="ops-admin-mobile-meta">
                {activeOrders !== null && (
                  <span
                    className="ops-admin-order-count"
                    aria-hidden="true"
                    data-empty={activeOrders === 0}
                  >
                    {activeOrders} active
                  </span>
                )}
                <span className="ops-admin-menu-icon" aria-hidden="true" />
              </span>
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
                      aria-label={
                        link.key === "staff" && activeOrders !== null
                          ? `${link.label}, ${orderCountLabel}`
                          : undefined
                      }
                      onClick={() => setMenuOpen(false)}
                    >
                      {link.label}
                      {link.key === "staff" && activeOrders !== null && (
                        <span
                          className="ops-admin-order-count"
                          aria-hidden="true"
                          data-empty={activeOrders === 0}
                        >
                          {activeOrders}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        )}
        <div className="ops-admin-content">{children}</div>
      </div>
      {!signIn && (
        <>
          <p className="ops-admin-order-announcement" role="status">
            {newOrders > 0 ? arrivalMessage : ""}
          </p>
          {newOrders > 0 && (
            <aside
              className="ops-admin-order-alert"
              aria-label={arrivalMessage}
            >
              <strong aria-hidden="true">{arrivalMessage}</strong>
              <Link
                href={staffWorkspaces.staff}
                onClick={() => setNewOrders(0)}
              >
                View orders
              </Link>
              <button
                type="button"
                aria-label="Dismiss order notification"
                onClick={() => setNewOrders(0)}
              >
                ×
              </button>
            </aside>
          )}
        </>
      )}
      <footer className="ops-admin-footer">
        Wok &amp; Chop · Kanata, Ontario
      </footer>
    </div>
  );
}
