"use client";
import { useState } from "react";
import Link from "next/link";
import { authRequest, useCustomer } from "../lib/customer-session";
import InkInscription from "./ink-inscription";
import CustomerDeliveries from "./customer-deliveries";
import CustomerOrderHistory from "./customer-order-history";
export default function AccountContent() {
  const user = useCustomer();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    const form = event.currentTarget;
    const submittedMode = mode;
    const data = new FormData(form);
    try {
      const body: Record<string, string> = {
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
      };
      if (submittedMode === "register")
        body.name = String(data.get("name") ?? "");
      await authRequest(submittedMode, body);
      form.reset();
      setNotice(
        submittedMode === "register"
          ? "Your account is ready."
          : "Welcome back.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to sign in. Please try again.",
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
      setNotice("You have been signed out. Your bag is still here.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign out.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className={
        user ? "account-section account-section--member" : "account-section"
      }
    >
      <div className="account-intro">
        <p className="handwritten">
          There’s a place for you here. <InkInscription>歡迎</InkInscription>
        </p>
        <h1>{user ? "Welcome to your table." : "Good to see you."}</h1>
        <p>
          {user ? (
            "Your account details and order history."
          ) : (
            <>
              Sign in to see your order history.
              <br />
              Or keep it simple and order as a guest.
            </>
          )}
        </p>
        <div className="account-illustration" aria-hidden="true">
          <img
            src="/images/art/kanata-table.webp"
            alt=""
            width={1200}
            height={800}
          />
        </div>
        <p className="account-dev-note">
          Use test details while exploring this local account and checkout.
        </p>
      </div>
      <div className="account-panel">
        {user ? (
          <>
            <p className="handwritten">{notice || "Make yourself at home."}</p>
            <h2>Hello, {user.name.split(" ")[0]}.</h2>
            <dl className="account-details">
              <div>
                <dt>Name</dt>
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
            </dl>
            <button className="text-link" onClick={signOut} disabled={pending}>
              {pending ? "Signing out…" : "Sign out"}
            </button>
          </>
        ) : (
          <>
            <div
              className="account-tabs"
              role="group"
              aria-label="Account options"
            >
              <button
                aria-pressed={mode === "login"}
                disabled={pending}
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                Sign in
              </button>
              <button
                aria-pressed={mode === "register"}
                disabled={pending}
                onClick={() => {
                  setMode("register");
                  setError("");
                  setNotice("");
                }}
              >
                Create an account
              </button>
            </div>
            <h2>{mode === "login" ? "Welcome back." : "Your table awaits."}</h2>
            <form onSubmit={submit}>
              {mode === "register" && (
                <label className="field-label">
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    placeholder="Your name"
                    required
                    minLength={1}
                    maxLength={80}
                  />
                </label>
              )}
              <label className="field-label">
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  maxLength={254}
                />
              </label>
              <label className="field-label">
                Password
                <div className="password-field">
                  <input
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
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              {mode === "register" && (
                <p className="field-hint">
                  Use at least 12 characters. Choose a password you don’t use
                  elsewhere for this local development account.
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="account-notice">
                  {notice}
                </p>
              )}
              <button
                className="primary-button"
                type="submit"
                disabled={pending}
              >
                {pending
                  ? "One moment…"
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
                <span>↗</span>
              </button>
              <p className="field-hint">
                Your account is stored on this development server.{" "}
                <Link href="/privacy/">Privacy details</Link>
              </p>
            </form>
            <div className="guest-divider">
              <span>Or, no account needed</span>
            </div>
            <Link href="/menu/" className="guest-button">
              Continue as a guest <span>↗</span>
            </Link>
            <Link href="/delivery/#track" className="text-link">Track a delivery <span aria-hidden="true">↗</span></Link>
          </>
        )}
        {user && error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {user && <CustomerDeliveries key={user.id} accountId={user.id} />}
      {user && <CustomerOrderHistory key={user.id} accountId={user.id} />}
    </section>
  );
}
