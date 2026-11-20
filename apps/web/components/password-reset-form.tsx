"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { API_URL, announceAccountSessionChanged } from "../lib/customer-session";
import "../styles/password-reset.css";

async function resetRequest(
  action: "request" | "confirm",
  body: Record<string, string>,
) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1/auth/password-reset/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Password reset is temporarily unavailable. Please try again.",
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    throw new Error(
      typeof result?.message === "string"
        ? result.message
        : "Password reset is temporarily unavailable. Please try again.",
    );
  }
}

export default function PasswordResetForm({
  initialEmail,
  onBack,
  onSuccess,
}: {
  initialEmail: string;
  onBack: (email: string) => void;
  onSuccess: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [resendAvailable, setResendAvailable] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [pending, setPending] = useState<"request" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sent) codeInput.current?.focus();
    else heading.current?.focus();
  }, [sent]);

  useEffect(() => {
    if (!sentAt) return;
    const timer = window.setTimeout(() => setResendAvailable(true), 60_000);
    return () => window.clearTimeout(timer);
  }, [sentAt]);

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending || (sent && !resendAvailable)) return;
    setPending("request");
    setError("");
    try {
      await resetRequest("request", { email });
      setSent(true);
      setSentAt(Date.now());
      setResendAvailable(false);
      if (codeInput.current) {
        codeInput.current.value = "";
        codeInput.current.focus();
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Couldn’t request the code.",
      );
    } finally {
      setPending(null);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirmPassword")) {
      setError("Enter the same password in both fields.");
      return;
    }
    setPending("confirm");
    setError("");
    try {
      await resetRequest("confirm", {
        email,
        code: String(data.get("code") ?? ""),
        password,
      });
      announceAccountSessionChanged();
      onSuccess(email);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn’t change your password.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="account-reset">
      <h2 ref={heading} tabIndex={-1}>
        {sent ? "Check your email." : "Reset your password."}
      </h2>
      {sent ? (
        <>
          <p className="account-notice" role="status">
            If {email} has an account, you’ll receive a six-digit code. The code
            expires in 10 minutes.
          </p>
          <form onSubmit={resetPassword}>
            <label className="field-label">
              Verification code
              <input
                name="code"
                ref={codeInput}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </label>
            <div className="field-label">
              <label htmlFor="reset-account-password">New password</label>
              <div className="password-field">
                <input
                  id="reset-account-password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="new-password"
                  aria-describedby="new-account-password-hint"
                  minLength={12}
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  aria-label={
                    showPassword ? "Hide passwords" : "Show passwords"
                  }
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <p className="field-hint" id="new-account-password-hint">
              Use at least 12 characters.
            </p>
            <label className="field-label">
              Confirm new password
              <input
                type={showPassword ? "text" : "password"}
                name="confirmPassword"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={Boolean(pending)}
            >
              {pending === "confirm" ? "Changing password…" : "Change password"}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <button
            className="text-link"
            type="button"
            disabled={Boolean(pending) || !resendAvailable}
            onClick={() => void sendCode()}
          >
            {pending === "request" ? "Requesting code…" : "Send another code"}
          </button>
          {!resendAvailable && (
            <p className="field-hint">
              You can request another code after one minute.
            </p>
          )}
          <button
            className="text-link"
            type="button"
            disabled={Boolean(pending)}
            onClick={() => {
              setSent(false);
              setError("");
              setShowPassword(false);
            }}
          >
            Change email address
          </button>
        </>
      ) : (
        <form onSubmit={sendCode}>
          <label className="field-label">
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button"
            type="submit"
            disabled={Boolean(pending)}
          >
            {pending === "request" ? "Requesting code…" : "Email me a code"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
      <button
        className="text-link"
        type="button"
        disabled={Boolean(pending)}
        onClick={() => onBack(email)}
      >
        Back to sign in
      </button>
    </div>
  );
}
