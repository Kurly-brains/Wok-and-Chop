"use client";

import { useState, type FormEvent } from "react";
import { API_URL, authRequest } from "../../lib/customer-session";
import { staffSessionPath } from "../../lib/staff-routes";
import InkInscription from "../ink-inscription";
import PasswordResetForm from "../password-reset-form";
import { OperationsShell } from "./OperationsShell";
import "../../styles/staff-sign-in.css";

export default function StaffSignIn({ destination }: { destination: string }) {
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      await authRequest("login", {
        email,
        password: String(data.get("password") ?? ""),
      });
      const access = await fetch(`${API_URL}${staffSessionPath}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (access.status === 401 || access.status === 403) {
        setError("This account doesn’t have staff access.");
        return;
      }
      if (!access.ok || (await access.json()).authorized !== true) {
        throw new Error(
          "Staff access is temporarily unavailable. Try again shortly.",
        );
      }
      window.location.replace(destination);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to sign in. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <OperationsShell active="sign-in">
      <main
        className="ops-main wc-staff-sign-in"
        id="main-content"
        tabIndex={-1}
      >
        <div className="wc-staff-sign-in-intro">
          <InkInscription>客家</InkInscription>
          <h1>Staff sign-in</h1>
          <p>
            Use your restaurant manager account to open the order desk, kitchen
            display and reservations.
          </p>
        </div>
        <section
          className="wc-staff-sign-in-panel"
          aria-labelledby="staff-sign-in-title"
        >
          {resetting ? (
            <>
              <h2 id="staff-sign-in-title">Reset your staff password</h2>
              <PasswordResetForm
                initialEmail={email}
                onBack={(address) => {
                  setEmail(address);
                  setResetting(false);
                }}
                onSuccess={(address) => {
                  setEmail(address);
                  setResetting(false);
                  setNotice(
                    "Password changed. Sign in with your new password.",
                  );
                }}
              />
            </>
          ) : (
            <>
              <h2 id="staff-sign-in-title">Welcome back</h2>
              <form onSubmit={signIn}>
                <label>
                  Email address
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <span className="wc-staff-password">
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </span>
                </label>
                {error && (
                  <p className="wc-staff-sign-in-error" role="alert">
                    {error}
                  </p>
                )}
                {notice && <p role="status">{notice}</p>}
                <button
                  className="wc-staff-sign-in-submit"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "Signing in…" : "Sign in to staff"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
              </form>
              <button
                className="wc-staff-sign-in-reset"
                type="button"
                onClick={() => {
                  setError("");
                  setResetting(true);
                }}
              >
                Forgot your password?
              </button>
            </>
          )}
        </section>
      </main>
    </OperationsShell>
  );
}
