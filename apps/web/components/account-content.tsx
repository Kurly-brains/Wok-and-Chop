"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCart } from "../lib/cart-store";
import {
  authRequest,
  useCustomer,
  type Customer,
} from "../lib/customer-session";
import {
  pickupCheckoutUrl,
  pickupTrackingUrl,
  uberEatsUrl,
} from "../lib/ordering";
import CustomerDeliveries from "./customer-deliveries";
import CustomerOrderHistory from "./customer-order-history";
import CustomerPickups from "./customer-pickups";
import InkInscription from "./ink-inscription";
import PasswordResetForm from "./password-reset-form";
import "../styles/customer-account.css";

const orders = [
  { id: "pickup", label: "Pickup" },
  { id: "delivery", label: "Earlier deliveries" },
  { id: "receipts", label: "Online receipts" },
] as const;

function AccountOverview({
  user,
  pending,
  error,
  onSignOut,
}: {
  user: Customer;
  pending: boolean;
  error: string;
  onSignOut(): void;
}) {
  const [view, setView] = useState<(typeof orders)[number]["id"]>("pickup");

  return (
    <section
      className="wc-account wc-account--member"
      aria-labelledby="account-title"
    >
      <header className="wc-account-heading">
        <div>
          <h1 id="account-title">My account</h1>
          <p>Welcome back, {user.name.split(/\s+/)[0]}.</p>
        </div>
        <Link className="wc-account-order-link" href="/menu/">
          Order pickup <span aria-hidden="true">→</span>
        </Link>
      </header>
      <div className="wc-account-dashboard">
        <section
          className="wc-account-orders"
          aria-labelledby="account-orders-title"
        >
          <h2 id="account-orders-title">Your orders</h2>
          <div
            className="wc-account-filters"
            role="group"
            aria-label="Order history type"
          >
            {orders.map(({ id, label }) => (
              <button
                type="button"
                key={id}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "pickup" && <CustomerPickups accountId={user.id} />}
          {view === "delivery" && <CustomerDeliveries accountId={user.id} />}
          {view === "receipts" && <CustomerOrderHistory accountId={user.id} />}
        </section>
        <aside
          className="wc-account-sidebar"
          aria-label="Account details and help"
        >
          <section
            className="wc-account-profile"
            aria-labelledby="profile-title"
          >
            <header className="wc-account-profile-head">
              <h2 id="profile-title">Profile</h2>
              <button
                className="wc-account-profile-signout"
                type="button"
                onClick={onSignOut}
                disabled={pending}
              >
                {pending ? "Signing out…" : "Sign out"}
              </button>
            </header>
            <dl>
              <div>
                <dt>Full name</dt>
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>Email address</dt>
                <dd>{user.email}</dd>
              </div>
            </dl>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </section>
          <section
            className="wc-account-support"
            aria-labelledby="account-support-title"
          >
            <h2 id="account-support-title">Order help</h2>
            <Link href={pickupTrackingUrl}>
              Track a pickup with a code <span aria-hidden="true">→</span>
            </Link>
            <a href={uberEatsUrl} target="_blank" rel="noopener noreferrer">
              Delivery on Uber Eats <span aria-hidden="true">↗</span>
            </a>
            <Link href="/contact/">
              Contact Wok &amp; Chop <span aria-hidden="true">→</span>
            </Link>
          </section>
        </aside>
      </div>
    </section>
  );
}

export default function AccountContent() {
  const user = useCustomer();
  const [cart] = useCart();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetEmail, setResetEmail] = useState<string | null>(null);
  const [signInEmail, setSignInEmail] = useState("");
  const signInEmailInput = useRef<HTMLInputElement>(null);
  const focusAfterReset = useRef(false);

  useEffect(() => {
    if (resetEmail === null && focusAfterReset.current && !user) {
      focusAfterReset.current = false;
      signInEmailInput.current?.focus();
    }
  }, [resetEmail, user]);

  function returnToSignIn(email: string, resetSucceeded = false) {
    focusAfterReset.current = true;
    setSignInEmail(email);
    setResetEmail(null);
    setError("");
    setNotice(
      resetSucceeded
        ? "Your password has changed. Sign in with your new password."
        : "",
    );
  }

  function switchMode(next: typeof mode) {
    setMode(next);
    setShowPassword(false);
    setError("");
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setNotice("");
    setPending(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const body = {
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
        ...(mode === "register"
          ? { name: String(data.get("name") ?? "") }
          : {}),
      };
      await authRequest(mode, body);
      form.reset();
      setShowPassword(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t sign you in. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setError("");
    try {
      await authRequest("logout");
      setMode("login");
      setShowPassword(false);
      setNotice("You’re signed out. Your bag is still here.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t sign you out. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  if (user) {
    return (
      <AccountOverview
        key={user.id}
        user={user}
        pending={pending}
        error={error}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <section
      className="wc-account wc-account--guest"
      aria-labelledby="account-title"
    >
      <header className="wc-account-heading">
        <div>
          <h1 id="account-title">Your account</h1>
          <p>
            See your orders, start a pickup, or track one you’ve already placed.
          </p>
        </div>
        <InkInscription>歡迎</InkInscription>
      </header>
      <div className="wc-account-entry">
        <section
          className="wc-account-guest"
          aria-labelledby="guest-account-title"
        >
          <div>
            <h2 id="guest-account-title">Continue as a guest</h2>
            <p>
              Place a pickup order at our Kanata restaurant without signing in.
            </p>
            <Link
              className="wc-account-primary"
              href={cart.length ? pickupCheckoutUrl : "/menu/"}
            >
              {cart.length
                ? "Continue to pickup checkout"
                : "Browse the pickup menu"}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="wc-account-guest-tracking">
            <h3>Already ordered?</h3>
            <Link href={pickupTrackingUrl}>
              Track a pickup with a private code{" "}
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/delivery/tracking/#track">
              Track an earlier direct delivery <span aria-hidden="true">→</span>
            </Link>
            <a href={uberEatsUrl} target="_blank" rel="noopener noreferrer">
              Open Uber Eats for delivery <span aria-hidden="true">↗</span>
            </a>
          </div>
          <img
            src="/images/art/kanata-table.webp"
            alt=""
            width={1200}
            height={800}
            decoding="async"
          />
        </section>
        <section
          className="account-panel wc-account-auth"
          aria-label="Customer account access"
        >
          {resetEmail !== null ? (
            <PasswordResetForm
              initialEmail={resetEmail}
              onBack={returnToSignIn}
              onSuccess={(email) => returnToSignIn(email, true)}
            />
          ) : (
            <>
              <div
                className="account-tabs"
                role="group"
                aria-label="Account options"
              >
                <button
                  type="button"
                  aria-pressed={mode === "login"}
                  disabled={pending}
                  onClick={() => switchMode("login")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "register"}
                  disabled={pending}
                  onClick={() => switchMode("register")}
                >
                  Create an account
                </button>
              </div>
              <h2>
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <form onSubmit={submit}>
                {mode === "register" && (
                  <label className="field-label">
                    Full name
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={80}
                    />
                  </label>
                )}
                <label className="field-label">
                  Email address
                  <input
                    ref={signInEmailInput}
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={signInEmail}
                    onChange={(event) => setSignInEmail(event.target.value)}
                    required
                    maxLength={254}
                  />
                </label>
                <label className="field-label">
                  Password
                  <span className="password-field">
                    <input
                      key={mode}
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      required
                      minLength={mode === "register" ? 12 : 1}
                      maxLength={128}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      aria-pressed={showPassword}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </span>
                </label>
                {mode === "register" && (
                  <p className="field-hint">Use at least 12 characters.</p>
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="account-notice" role="status">
                    {notice}
                  </p>
                )}
                <button
                  className="wc-account-primary"
                  type="submit"
                  disabled={pending}
                >
                  {pending
                    ? "One moment…"
                    : mode === "login"
                      ? "Sign in"
                      : "Create account"}
                  <span aria-hidden="true">→</span>
                </button>
                {mode === "login" && (
                  <button
                    className="text-link account-forgot-password"
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setShowPassword(false);
                      setNotice("");
                      setError("");
                      setResetEmail(
                        signInEmailInput.current?.value ?? signInEmail,
                      );
                    }}
                  >
                    Forgot your password?
                  </button>
                )}
                <p className="field-hint">
                  Use sample details in this preview.{" "}
                  <Link href="/privacy/">Privacy policy</Link>
                </p>
              </form>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
