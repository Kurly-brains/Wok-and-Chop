"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { priceLine, type CartSelection } from "@wok/domain";
import { getCartSnapshot, useCart, type CartLine } from "../lib/cart-store";
import { refreshCustomer, useCustomer } from "../lib/customer-session";
import { useMenuCatalog } from "../lib/menu-catalog";
import { pickupTrackingUrl } from "../lib/ordering";
import { PickupLocation, PickupOrderSummary } from "./pickup-details";
import {
  PickupRequestError,
  pickupPromoKey,
  pickupStatusLabels,
  pickupTrackingCode,
  pickupTrackingKey,
  readPickupSession,
  requestPickup,
  writePickupSession,
  type PickupOrder,
  type PickupQuote,
  type PickupTotal,
} from "../lib/pickup";
import "../styles/pickup.css";

type Config = { enabled: boolean; mode?: "LOCAL_UNPAID" | "PAY_AT_PICKUP" };
type Contact = { name: string; phone: string; email: string; promoCode: string };
type Review = {
  contact: Contact;
  cart: CartLine[];
  lines: CartSelection[];
  quote: PickupQuote;
  requestId: string;
  expectedAccountId: string | null;
};
type Receipt = { pickup: PickupOrder; trackingToken: string };

const pendingKey = "wok-chop:pending-pickup";

async function requestIdentity(payload: object) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const [storedFingerprint, storedId] = readPickupSession(pendingKey).split(":");
  if (storedFingerprint === fingerprint && storedId) return storedId;
  const requestId = crypto.randomUUID();
  writePickupSession(pendingKey, `${fingerprint}:${requestId}`);
  return requestId;
}

export default function PickupContent() {
  const [cart, setCart] = useCart();
  const menu = useMenuCatalog();
  const customer = useCustomer();
  const [config, setConfig] = useState<Config | null>(null);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [savedPromo, setSavedPromo] = useState("");
  const [contact, setContact] = useState<Contact | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const requestActive = useRef(false);
  const stageTitle = useRef<HTMLHeadingElement>(null);

  const items = cart.map((line) => {
    const priced = priceLine(line, menu);
    return { ...priced, modifiers: priced.modifiers.map((modifier) => modifier.name) };
  });
  const subtotal = items.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const estimate: PickupTotal = {
    items,
    subtotalCents: subtotal,
    discountCents: 0,
    totalCents: subtotal,
    taxCents: null,
  };
  const changedBag = review && JSON.stringify(review.cart) !== JSON.stringify(cart);

  useEffect(() => {
    const controller = new AbortController();
    requestPickup<Config>("/config", { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setConfig(value);
        setSavedPromo(readPickupSession(pickupPromoKey));
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfig(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (review || receipt) stageTitle.current?.focus();
  }, [review, receipt]);

  async function reviewOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestActive.current || !config?.enabled) return;
    const form = new FormData(event.currentTarget);
    const nextContact = {
      name: String(form.get("name") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      promoCode: String(form.get("promoCode") ?? "").trim().toUpperCase(),
    };
    if (!nextContact.name) {
      setError("Enter the name for your pickup.");
      return;
    }
    const phone = nextContact.phone.replace(/[ ()+.\-]/g, "").replace(/^1(?=\d{10}$)/, "");
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(phone)) {
      setError("Enter a valid ten-digit contact phone number.");
      return;
    }
    const currentCart = getCartSnapshot();
    if (!currentCart.length) return;
    const lines = currentCart.map(({ itemId, quantity, modifierIds, note }) => ({
      itemId, quantity, modifierIds, note,
    }));
    requestActive.current = true;
    setContact(nextContact);
    setBusy(true);
    setError("");
    try {
      const [quote, account] = await Promise.all([
        requestPickup<PickupQuote>("/quote", {
          method: "POST",
          body: JSON.stringify({ lines, promoCode: nextContact.promoCode || undefined }),
        }),
        refreshCustomer(),
      ]);
      const expectedAccountId = account?.id ?? null;
      const requestId = await requestIdentity({
        contact: { ...nextContact, phone },
        lines,
        quoteFingerprint: quote.quoteFingerprint,
        account: expectedAccountId ?? undefined,
      });
      setReview({ contact: nextContact, cart: currentCart, lines, quote, requestId, expectedAccountId });
    } catch (cause) {
      setError(cause instanceof PickupRequestError ? cause.message : "We couldn’t review your order. Try again.");
    } finally {
      requestActive.current = false;
      setBusy(false);
    }
  }

  async function submitOrder() {
    if (!review || requestActive.current || (changedBag && !uncertain)) return;
    requestActive.current = true;
    setBusy(true);
    setError("");
    let result: Receipt;
    try {
      result = await requestPickup<Receipt>("", {
        method: "POST",
        body: JSON.stringify({
          ...review.contact,
          email: review.contact.email || undefined,
          promoCode: review.contact.promoCode || undefined,
          requestId: review.requestId,
          lines: review.lines,
          quoteFingerprint: review.quote.quoteFingerprint,
          expectedTotalCents: review.quote.totalCents,
          expectedAccountId: review.expectedAccountId,
        }),
      });
      if (!result.pickup?.number || !pickupTrackingCode.test(result.trackingToken)) {
        throw new PickupRequestError("Pickup confirmation is unavailable.", 502);
      }
    } catch (cause) {
      const sessionChanged = cause instanceof PickupRequestError && cause.code === "CHECKOUT_ACCOUNT_CHANGED";
      const unknown = uncertain || !(cause instanceof PickupRequestError) || cause.status >= 500;
      setUncertain(unknown);
      if (unknown) {
        setError(sessionChanged
          ? "We couldn’t confirm the earlier submission. Restore the original account session to check this order, or call the restaurant."
          : "We couldn’t confirm the submission. Check again with the same order.");
      } else {
        setError(cause instanceof PickupRequestError ? cause.message : "The pickup could not be submitted.");
      }
      return;
    } finally {
      requestActive.current = false;
      setBusy(false);
    }
    setReceipt(result);
    setReview(null);
    setContact(null);
    setSavedPromo("");
    setUncertain(false);
    setCopied(false);
    writePickupSession(pickupTrackingKey, result.trackingToken);
    writePickupSession(pendingKey, "");
    writePickupSession(pickupPromoKey, "");
    const ordered = new Map(review.cart.map((line) => [line.key, JSON.stringify(line)]));
    setCart((current) => current.filter((line) => ordered.get(line.key) !== JSON.stringify(line)));
  }

  async function copyCode() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.trackingToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function startOver() {
    setReview(null);
    setError("");
  }

  return (
    <section className="pickup-checkout" aria-labelledby="pickup-title">
      <header className="pickup-header">
        <Link className="pickup-back" href="/order/">← Ordering options</Link>
        <h1 id="pickup-title">Pickup checkout</h1>
        <p>Order from Wok &amp; Chop and pay when you collect.</p>
      </header>

      <div className={review ? "pickup-layout pickup-layout--review" : "pickup-layout"}>
        <div className="pickup-main">
          {receipt ? (
            <section className="pickup-card pickup-confirmation" aria-labelledby="pickup-confirmation">
              <p className="pickup-receipt-number">Order {receipt.pickup.number}</p>
              <h2 id="pickup-confirmation" tabIndex={-1} ref={stageTitle}>
                {config?.mode === "LOCAL_UNPAID" && receipt.pickup.status === "RECEIVED"
                  ? "Test pickup request received"
                  : pickupStatusLabels[receipt.pickup.status]}
              </h2>
              <p>Save your order number and private code to check when your pickup is ready.</p>
              <PickupLocation />
              <div className="pickup-actions">
                <Link className="pickup-primary" href={pickupTrackingUrl}>Track pickup <span aria-hidden="true">→</span></Link>
                <Link className="pickup-link" href="/menu/">Back to menu</Link>
              </div>
              <details className="pickup-private-code">
                <summary>Private tracking code</summary>
                <p className="pickup-code">{receipt.trackingToken}</p>
                <button className="pickup-secondary" type="button" onClick={() => void copyCode()}>
                  {copied ? "Code copied" : "Copy code"}
                </button>
              </details>
              {cart.length > 0 && (
                <button className="pickup-secondary" type="button" onClick={() => setReceipt(null)}>
                  Start another pickup order
                </button>
              )}
            </section>
          ) : review ? (
            <section className="pickup-card pickup-review-grid" aria-labelledby="pickup-review">
              <div className="pickup-review-details">
                <h2 id="pickup-review" tabIndex={-1} ref={stageTitle}>Review your pickup</h2>
                <PickupLocation />
                <dl className="pickup-contact-list">
                  <div><dt>Pickup name</dt><dd>{review.contact.name}</dd></div>
                  <div><dt>Phone number</dt><dd>{review.contact.phone}</dd></div>
                  {review.contact.email && <div><dt>Email updates</dt><dd>{review.contact.email}</dd></div>}
                  <div><dt>Order history</dt><dd>{review.expectedAccountId ? "Saved to your account" : "Guest pickup · Private tracking code"}</dd></div>
                  <div><dt>Payment</dt><dd>At pickup</dd></div>
                </dl>
              </div>
              <PickupOrderSummary totals={review.quote} reviewed />
              <div className="pickup-review-footer">
                {config?.mode === "LOCAL_UNPAID" && (
                  <p className="pickup-note">This is a local test order. No payment will be taken.</p>
                )}
                {changedBag && !uncertain && <p className="pickup-error" role="alert">Your bag changed. Review it again before submitting.</p>}
                {error && <p className="pickup-error" role="alert">{error}</p>}
                <div className="pickup-actions">
                  <button className="pickup-primary" type="button" disabled={busy || Boolean(changedBag && !uncertain)} onClick={() => void submitOrder()}>
                    {busy ? "Submitting…" : uncertain ? "Check submission" : "Place pickup order"}
                  </button>
                  <button className="pickup-secondary" type="button" disabled={busy || uncertain} onClick={startOver}>Edit details</button>
                </div>
                <Link className="pickup-link" href="/terms/">Terms &amp; Conditions</Link>
              </div>
            </section>
          ) : (
            <section className="pickup-card" aria-labelledby="pickup-details">
              <h2 id="pickup-details">
                {checking ? "Pickup details" : !config?.enabled ? "Order pickup by phone" : cart.length ? "Pickup details" : "Start with the menu"}
              </h2>
              <PickupLocation />
              {checking ? (
                <p role="status">Checking pickup availability…</p>
              ) : !config?.enabled ? (
                <>
                  <p>Call the restaurant to place your pickup order.</p>
                  <div className="pickup-actions">
                    <a className="pickup-primary" href="tel:+16135911111">Call (613) 591-1111</a>
                    <Link className="pickup-link" href="/menu/">Browse menu</Link>
                    {!config && <button className="pickup-secondary" type="button" onClick={() => { setChecking(true); setAttempt((value) => value + 1); }}>Check again</button>}
                  </div>
                </>
              ) : !cart.length ? (
                <>
                  <p>Choose the dishes you’d like to collect.</p>
                  <Link className="pickup-primary" href="/menu/">Browse menu <span aria-hidden="true">↗</span></Link>
                </>
              ) : (
                <form className="pickup-form" onSubmit={reviewOrder}>
                  <div className="pickup-fields">
                    <label>Pickup name
                      <input name="name" autoComplete="name" maxLength={80} defaultValue={contact?.name ?? customer?.name} required />
                    </label>
                    <label>Phone number
                      <input name="phone" type="tel" autoComplete="tel" maxLength={32} defaultValue={contact?.phone} required />
                    </label>
                    <label>Email for order updates <small>Optional</small>
                      <input name="email" type="email" autoComplete="email" maxLength={254} defaultValue={contact?.email ?? customer?.email} />
                    </label>
                  </div>
                  <details className="pickup-promo" open={Boolean(contact?.promoCode || savedPromo) || undefined}>
                    <summary>Promo code</summary>
                    <label className="pickup-promo-field"><span className="pickup-sr-only">Promo code</span>
                      <input name="promoCode" autoComplete="off" autoCapitalize="characters" maxLength={24} defaultValue={contact?.promoCode ?? savedPromo} />
                    </label>
                  </details>
                  {error && <p className="pickup-error" role="alert">{error}</p>}
                  <button className="pickup-primary" type="submit" disabled={busy}>
                    {busy ? "Reviewing…" : "Review pickup order"} <span aria-hidden="true">→</span>
                  </button>
                </form>
              )}
            </section>
          )}

          {!receipt && !review && (
            <section id="track-pickup" className="pickup-card" aria-labelledby="pickup-track">
              <h2 id="pickup-track">Track an existing pickup</h2>
              <p>Use the private code from your pickup confirmation.</p>
              <Link className="pickup-link" href={pickupTrackingUrl}>Track pickup <span aria-hidden="true">→</span></Link>
            </section>
          )}
        </div>
        {!review && (receipt || cart.length > 0) && (
          <PickupOrderSummary totals={receipt?.pickup ?? estimate} reviewed={Boolean(receipt)} />
        )}
      </div>
    </section>
  );
}
