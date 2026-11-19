"use client";

import { useState, type FormEvent } from "react";
import { authRequest } from "../../lib/customer-session";

export function ManagerSignIn({ description, onSignedIn }: { description: string; onSignedIn?: () => void }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      await authRequest("login", { email: String(data.get("email")), password: String(data.get("password")) });
      onSignedIn?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    } finally { setPending(false); }
  }
  return <form className="directory-login" onSubmit={submit}>
    <h2>Manager sign-in</h2>
    <p>{description}</p>
    <label>Email address<input name="email" type="email" autoComplete="username" required /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
    {message && <p role="alert">{message}</p>}
    <button className="ops-button" disabled={pending}>{pending ? "Signing in…" : "Sign in"}<span aria-hidden="true">→</span></button>
  </form>;
}
