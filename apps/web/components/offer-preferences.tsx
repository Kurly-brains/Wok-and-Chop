"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { guestServiceRequest } from "../lib/guest-services";
import InkInscription from "./ink-inscription";
import "../styles/offer-preferences.css";

export function OfferSignup() {
  const [availability, setAvailability] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void guestServiceRequest<{ emailEnabled: boolean }>("marketing/config/", {
      signal: controller.signal,
    })
      .then((config) =>
        setAvailability(config.emailEnabled ? "ready" : "unavailable"),
      )
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("unavailable");
      });
    return () => controller.abort();
  }, []);

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || availability !== "ready") return;
    const fields = new FormData(event.currentTarget);
    if (fields.get("consent") !== "on") return;
    setPending(true);
    setError("");
    try {
      await guestServiceRequest("marketing/subscribe/", {
        body: { email: fields.get("email"), consent: true },
      });
      setSent(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "We couldn’t sign you up. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="wc-offer-page" aria-labelledby="wc-offer-title">
      <div className="wc-offer-heading">
        <InkInscription>好味</InkInscription>
        <h1 id="wc-offer-title">
          Offers from
          <br />
          our kitchen.
        </h1>
        <p>Get occasional Wok &amp; Chop offers by email.</p>
      </div>
      <div className="wc-offer-form-area">
        {sent ? (
          <div role="status">
            <h2>Check your inbox</h2>
            <p>
              If this address is new to our list, we’ll send you a link to
              confirm your signup.
            </p>
          </div>
        ) : (
          <>
            <h2>Get email offers</h2>
            {availability === "loading" && (
              <p role="status">Checking signup availability…</p>
            )}
            {availability === "unavailable" && (
              <p role="status">
                Email signup is currently unavailable. Please check back later.
              </p>
            )}
            {availability === "ready" && (
              <form className="wc-offer-form" onSubmit={signup}>
                <label className="wc-offer-email" htmlFor="offer-email">
                  Email address
                  <input
                    id="offer-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    disabled={pending}
                  />
                </label>
                <label className="wc-offer-consent">
                  <input
                    type="checkbox"
                    name="consent"
                    required
                    disabled={pending}
                  />
                  <span>
                    I agree to receive offers by email from Wok &amp; Chop. I
                    can unsubscribe at any time.
                  </span>
                </label>
                <button
                  className="wc-offer-button"
                  type="submit"
                  disabled={pending}
                >
                  {pending ? "Signing up…" : "Sign up for offers"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
                {error && (
                  <p className="wc-offer-error" role="alert">
                    {error}
                  </p>
                )}
              </form>
            )}
            <p className="wc-offer-identity">
              Wok &amp; Chop · 790 Kanata Avenue, Unit M2A, Kanata, ON
              <br />
              <a href="mailto:info@wokandchop.ca">info@wokandchop.ca</a> ·{" "}
              <Link href="/privacy/">Privacy</Link>
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export function OfferPreference({
  action,
  token,
}: {
  action: "confirm" | "unsubscribe";
  token: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const confirming = action === "confirm";
  const label = confirming ? "Confirm email signup" : "Unsubscribe from offers";

  async function updatePreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || pending) return;
    setPending(true);
    setError("");
    try {
      await guestServiceRequest(`marketing/${action}/`, { body: { token } });
      setDone(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "We couldn’t update your preferences. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="wc-offer-page wc-offer-page--preference"
      aria-labelledby="wc-offer-title"
    >
      <div className="wc-offer-heading">
        <InkInscription>好味</InkInscription>
        <h1 id="wc-offer-title">Email preferences.</h1>
      </div>
      <div className="wc-offer-form-area">
        {done ? (
          <div role="status">
            <h2>{confirming ? "You’re signed up" : "You’re unsubscribed"}</h2>
            <p>
              {confirming
                ? "You’ll receive occasional Wok & Chop offers by email."
                : "We’ll stop sending you Wok & Chop offers."}
            </p>
          </div>
        ) : (
          <>
            <h2>{label}</h2>
            {token ? (
              <form className="wc-offer-form" onSubmit={updatePreference}>
                <p>
                  {confirming
                    ? "Confirm that you’d like to receive occasional Wok & Chop offers."
                    : "Remove this address from the Wok & Chop offers list."}
                </p>
                <button
                  className="wc-offer-button"
                  type="submit"
                  disabled={pending}
                >
                  {pending
                    ? "Updating…"
                    : confirming
                      ? "Confirm signup"
                      : "Unsubscribe"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
                {error && (
                  <p className="wc-offer-error" role="alert">
                    {error}
                  </p>
                )}
              </form>
            ) : (
              <p>
                This link is incomplete. Open the original link in your email.
              </p>
            )}
          </>
        )}
        <Link
          className="wc-offer-back"
          href={confirming && error ? "/offers/" : "/"}
        >
          {confirming && error ? "Sign up again" : "Back to Wok & Chop"}{" "}
          <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
}
