"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatMoney, priceLine, type CartSelection } from "@wok/domain";
import { useCart, type CartLine } from "../lib/cart-store";
import { useCustomer } from "../lib/customer-session";
import { useMenuCatalog } from "../lib/menu-catalog";
import {
  DeliveryRequestError,
  deliveryPromoKey,
  deliveryStages,
  guestReceiptKey,
  readDeliverySession,
  requestDelivery,
  saveDeliverySession,
  type Delivery,
  type DeliveryQuote,
} from "../lib/delivery";
import InkInscription from "./ink-inscription";
import "../styles/delivery.css";

type DeliveryDetails = {
  name: string;
  phone: string;
  address: {
    street: string;
    unit: string;
    city: string;
    province: "ON";
    postalCode: string;
  };
  instructions: string;
  promoCode: string;
};
type Receipt = { delivery: Delivery; trackingToken: string };
type Review = {
  details: DeliveryDetails;
  cart: CartLine[];
  lines: CartSelection[];
  quote: DeliveryQuote;
  requestId: string;
};
type DeliveryConfig = { enabled: boolean; postalPrefixes: string[] };
const pendingKey = "wok-chop:pending-delivery";
const blankDetails: DeliveryDetails = {
  name: "",
  phone: "",
  address: { street: "", unit: "", city: "", province: "ON", postalCode: "" },
  instructions: "",
  promoCode: "",
};

async function requestIdentity(payload: object) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const key = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const saved = readDeliverySession(pendingKey);
  if (saved.startsWith(`${key}:`)) return saved.slice(key.length + 1);
  const id = crypto.randomUUID();
  saveDeliverySession(pendingKey, `${key}:${id}`);
  return id;
}

function DeliveryAddress({ address }: { address: DeliveryDetails["address"] }) {
  return (
    <address>
      {address.street}
      {address.unit && `, Unit ${address.unit}`}
      <br />
      {address.city}, {address.province} {address.postalCode}
    </address>
  );
}

export function DeliveryProgress({ status }: { status: Delivery["status"] }) {
  const current = deliveryStages.findIndex((stage) => stage.id === status);
  if (status === "CANCELLED")
    return <p className="delivery-cancelled">This order was cancelled.</p>;
  return (
    <ol className="delivery-progress" aria-label="Delivery progress">
      {deliveryStages.map((stage, index) => (
        <li
          key={stage.id}
          data-done={index <= current}
          aria-current={index === current ? "step" : undefined}
        >
          {stage.label}
        </li>
      ))}
    </ol>
  );
}

function TrackDelivery({ receipt }: { receipt: Receipt | null }) {
  const [delivery, setDelivery] = useState(receipt?.delivery ?? null);
  const [trackingToken, setTrackingToken] = useState(
    receipt?.trackingToken ?? "",
  );
  const [message, setMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [pending, setPending] = useState(false);
  const activeToken = useRef(receipt?.trackingToken ?? "");

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      const savedToken =
        activeToken.current || readDeliverySession(guestReceiptKey);
      if (!savedToken) return;
      void requestDelivery<{ delivery: Delivery }>("/track", {
        method: "POST",
        body: JSON.stringify({ trackingToken: savedToken }),
        signal: controller.signal,
      })
        .then(({ delivery }) => {
          if (
            controller.signal.aborted ||
            (activeToken.current && activeToken.current !== savedToken)
          )
            return;
          activeToken.current = savedToken;
          setTrackingToken((token) => token || savedToken);
          setDelivery((current) =>
            current?.id === delivery.id && current.version >= delivery.version
              ? current
              : delivery,
          );
        })
        .catch(() => {
          /* A manual lookup exposes connection or code errors. */
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function track(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setCopyStatus("");
    const token = trackingToken.trim().toLowerCase();
    try {
      const result = await requestDelivery<{ delivery: Delivery }>("/track", {
        method: "POST",
        body: JSON.stringify({ trackingToken: token }),
      });
      activeToken.current = token;
      setDelivery(result.delivery);
      saveDeliverySession(guestReceiptKey, token);
    } catch (error) {
      setMessage(
        error instanceof DeliveryRequestError
          ? error.message
          : "Tracking is unavailable. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(activeToken.current);
      setCopyStatus("Tracking code copied.");
    } catch {
      setCopyStatus("Select the code in the field to copy it.");
    }
  }

  return (
    <section
      className="delivery-panel delivery-tracking"
      id="track"
      aria-labelledby="tracking-title"
    >
      <h2 id="tracking-title">
        {delivery ? `Delivery ${delivery.number}` : "Track a delivery"}
      </h2>
      {delivery && (
        <div aria-live="polite">
          <DeliveryProgress status={delivery.status} />
          <ul className="delivery-receipt-lines">
            {delivery.items.map((item, index) => (
              <li key={index}>
                {item.quantity} × {item.name}
              </li>
            ))}
          </ul>
          <p className="delivery-tracking-total">
            Food total <strong>{formatMoney(delivery.totalCents)} CAD</strong>
          </p>
        </div>
      )}
      <form onSubmit={track} className="delivery-tracking-form">
        <label>
          Private tracking code
          <input
            value={trackingToken}
            onChange={(event) => setTrackingToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={64}
            pattern="[0-9A-Fa-f]{64}"
            title="Enter the 64-character code from your receipt"
            aria-describedby="delivery-code-help"
          />
        </label>
        <button className="delivery-secondary" disabled={pending}>
          {pending
            ? "Checking…"
            : delivery
              ? "Refresh status"
              : "Find my order"}
        </button>
      </form>
      <p id="delivery-code-help" className="delivery-caption">
        {delivery
          ? "Save your private tracking code to check this order on another device."
          : "Enter the private code from your order confirmation."}
      </p>
      {delivery && (
        <button
          type="button"
          className="delivery-copy-code"
          onClick={() => void copyCode()}
        >
          Copy private code
        </button>
      )}
      {copyStatus && (
        <p className="delivery-caption" role="status">
          {copyStatus}
        </p>
      )}
      {message && (
        <p className="delivery-error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}

export default function DeliveryContent() {
  const customer = useCustomer();
  const menu = useMenuCatalog();
  const [cart, setCart] = useCart();
  const [config, setConfig] = useState<DeliveryConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [configAttempt, setConfigAttempt] = useState(0);
  const [details, setDetails] = useState<DeliveryDetails | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const priced = cart.map((line) => priceLine(line, menu));
  const changedBag =
    review !== null && JSON.stringify(review.cart) !== JSON.stringify(cart);
  const editing = !review && !receipt;

  useEffect(() => {
    const controller = new AbortController();
    void requestDelivery<DeliveryConfig>("/config", {
      signal: controller.signal,
    })
      .then((config) => {
        if (!controller.signal.aborted) {
          setConfig(config);
          setConfigError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setConfigError(
            "The delivery service is unavailable. Your bag is saved.",
          );
      });
    return () => controller.abort();
  }, [configAttempt]);

  useEffect(() => {
    if (review || receipt) stageHeading.current?.focus();
  }, [review, receipt]);

  async function quote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const read = (field: string) => String(fields.get(field) ?? "").trim();
    const nextDetails: DeliveryDetails = {
      name: read("name"),
      phone: read("phone"),
      address: {
        street: read("street"),
        unit: read("unit"),
        city: read("city"),
        province: "ON",
        postalCode: read("postalCode").toUpperCase(),
      },
      instructions: read("instructions"),
      promoCode: read("promoCode").toUpperCase(),
    };
    const lines = cart.map(({ itemId, quantity, modifierIds, note }) => ({
      itemId,
      quantity,
      modifierIds,
      note,
    }));
    setDetails(nextDetails);
    setMessage("");
    setPending(true);
    try {
      const quote = await requestDelivery<DeliveryQuote>("/quote", {
        method: "POST",
        body: JSON.stringify({
          lines,
          postalCode: nextDetails.address.postalCode,
          promoCode: nextDetails.promoCode || undefined,
        }),
      });
      const requestId = await requestIdentity({
        details: nextDetails,
        lines,
        fingerprint: quote.quoteFingerprint,
        account: customer?.id,
      });
      setReview({ details: nextDetails, cart, lines, quote, requestId });
    } catch (error) {
      setMessage(
        error instanceof DeliveryRequestError
          ? error.message
          : "We couldn’t review your order. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function placeOrder() {
    if (!review || pending || (changedBag && !uncertain)) return;
    setPending(true);
    setMessage("");
    try {
      const result = await requestDelivery<Receipt>("", {
        method: "POST",
        body: JSON.stringify({
          ...review.details,
          promoCode: review.details.promoCode || undefined,
          requestId: review.requestId,
          lines: review.lines,
          quoteFingerprint: review.quote.quoteFingerprint,
        }),
      });
      saveDeliverySession(guestReceiptKey, result.trackingToken);
      saveDeliverySession(deliveryPromoKey, "");
      saveDeliverySession(pendingKey, "");
      setCart((current) =>
        current.filter(
          (line) =>
            !review.cart.some(
              (ordered) => JSON.stringify(ordered) === JSON.stringify(line),
            ),
        ),
      );
      setReceipt(result);
      setReview(null);
      setUncertain(false);
    } catch (error) {
      const unknownOutcome =
        !(error instanceof DeliveryRequestError) || error.status >= 500;
      setUncertain(unknownOutcome);
      setMessage(
        unknownOutcome
          ? "We couldn’t confirm the submission. Check again using the same order details."
          : error.message,
      );
    } finally {
      setPending(false);
    }
  }

  const form = details ?? blankDetails;
  const totals = review?.quote;
  const orderItems =
    totals?.items ??
    priced.map((line) => ({
      ...line,
      modifiers: line.modifiers.map((option) => option.name),
    }));
  return (
    <div className="wc-delivery">
      <header className="delivery-masthead">
        <div>
          <Link className="delivery-back" href="/menu/">
            ← Back to the menu
          </Link>
          <h1>
            Home delivery <InkInscription>開飯</InkInscription>
          </h1>
          <p>
            Order from Wok &amp; Chop and follow your meal from the kitchen to
            your door.
          </p>
          <a className="delivery-track-link" href="#track">
            Track an existing order ↓
          </a>
        </div>
        <img
          src="/images/chicken-cutout.webp"
          width={850}
          height={850}
          alt=""
        />
      </header>
      <p className="delivery-preview">
        Local test orders only. Use sample contact and address details.
      </p>
      <div className={`delivery-layout${receipt || !orderItems.length ? " delivery-layout--no-bag" : ""}`}>
        <div className="delivery-main">
          {receipt ? (
            <section
              className="delivery-panel delivery-confirmation"
              aria-labelledby="delivery-confirmation"
            >
              <h2 id="delivery-confirmation" ref={stageHeading} tabIndex={-1}>
                Order received.
              </h2>
              <p>
                Your test order <strong>{receipt.delivery.number}</strong> is on
                the restaurant’s delivery board.
              </p>
              <a className="delivery-track-link" href="#track">
                View delivery progress ↓
              </a>
            </section>
          ) : review ? (
            <section className="delivery-panel delivery-review">
              <h2 ref={stageHeading} tabIndex={-1}>
                Review your delivery
              </h2>
              <div className="delivery-review-details">
                <div>
                  <h3>Deliver to</h3>
                  <DeliveryAddress address={review.details.address} />
                </div>
                <div>
                  <h3>Contact</h3>
                  <p>
                    {review.details.name}
                    <br />
                    {review.details.phone}
                  </p>
                </div>
              </div>
              {review.details.instructions && (
                <p>
                  <strong>Drop-off instructions</strong>
                  <br />
                  {review.details.instructions}
                </p>
              )}
              <p className="delivery-caption">
                This test order records the reviewed food total. No payment is
                collected.
              </p>
              {changedBag && !uncertain && (
                <p className="delivery-error" role="alert">
                  Your bag changed. Review the updated order before placing it.
                </p>
              )}
              {message && (
                <p className="delivery-error" role="alert">
                  {message}
                </p>
              )}
              <div className="delivery-actions">
                <button
                  className="delivery-primary"
                  type="button"
                  disabled={pending || (changedBag && !uncertain)}
                  onClick={() => void placeOrder()}
                >
                  {pending
                    ? "Checking order…"
                    : uncertain
                      ? "Check order submission"
                      : "Place test order"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
                {!uncertain && (
                  <button
                    className="delivery-secondary"
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setReview(null);
                      setMessage("");
                    }}
                  >
                    Edit details
                  </button>
                )}
              </div>
            </section>
          ) : !cart.length ? (
            <section className="delivery-panel">
              <h2>Start with the menu</h2>
              <p>Add dishes to your bag to place a delivery order.</p>
              <Link className="delivery-primary" href="/menu/">
                Choose your dishes <span aria-hidden="true">→</span>
              </Link>
            </section>
          ) : (
            <form className="delivery-panel delivery-form" onSubmit={quote}>
              <h2>Delivery details</h2>
              <div className="delivery-fields">
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                    defaultValue={details?.name ?? customer?.name}
                  />
                </label>
                <label>
                  Phone number
                  <input
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    required
                    maxLength={30}
                    defaultValue={form.phone}
                  />
                </label>
                <label className="delivery-wide">
                  Street address
                  <input
                    name="street"
                    autoComplete="address-line1"
                    required
                    maxLength={140}
                    defaultValue={form.address.street}
                  />
                </label>
                <label>
                  Apartment or unit <small>Optional</small>
                  <input
                    name="unit"
                    autoComplete="address-line2"
                    maxLength={40}
                    defaultValue={form.address.unit}
                  />
                </label>
                <label>
                  City
                  <input
                    name="city"
                    autoComplete="address-level2"
                    required
                    maxLength={80}
                    defaultValue={form.address.city}
                  />
                </label>
                <div className="delivery-static">
                  <span>Province</span>
                  <strong>Ontario</strong>
                </div>
                <label>
                  Postal code
                  <input
                    name="postalCode"
                    autoComplete="postal-code"
                    autoCapitalize="characters"
                    required
                    maxLength={7}
                    defaultValue={form.address.postalCode}
                  />
                </label>
                <label className="delivery-wide">
                  Drop-off instructions <small>Optional</small>
                  <textarea
                    name="instructions"
                    rows={2}
                    maxLength={400}
                    defaultValue={form.instructions}
                  />
                </label>
              </div>
              <PromoField saved={details?.promoCode} />
              {config?.postalPrefixes.length ? (
                <p className="delivery-caption">
                  Test delivery area {config.postalPrefixes.join(", ")}.
                </p>
              ) : null}
              {message && (
                <p className="delivery-error" role="alert">
                  {message}
                </p>
              )}
              {configError && (
                <p className="delivery-error" role="alert">
                  {configError}{" "}
                  <button
                    type="button"
                    onClick={() => setConfigAttempt((value) => value + 1)}
                  >
                    Retry
                  </button>
                </p>
              )}
              <button
                className="delivery-primary"
                disabled={pending || !config?.enabled}
              >
                {pending ? "Reviewing…" : "Review delivery"}{" "}
                <span aria-hidden="true">→</span>
              </button>
            </form>
          )}
          <TrackDelivery
            key={receipt?.delivery.id ?? "guest-tracking"}
            receipt={receipt}
          />
        </div>
        {!receipt && orderItems.length > 0 && (
          <aside
            className="delivery-panel delivery-bag"
            aria-labelledby="delivery-bag-title"
          >
            <h2 id="delivery-bag-title">Your order</h2>
            <ul>
              {orderItems.map((line, index) => (
                <li key={index}>
                  <div>
                    <strong>
                      {line.quantity} × {line.name}
                    </strong>
                    {line.modifiers.length > 0 && (
                      <small>{line.modifiers.join(" · ")}</small>
                    )}
                  </div>
                  <span>{formatMoney(line.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            <dl>
              <div>
                <dt>Food subtotal</dt>
                <dd>
                  {formatMoney(
                    totals?.subtotalCents ??
                      priced.reduce(
                        (sum, line) => sum + line.lineTotalCents,
                        0,
                      ),
                  )}
                </dd>
              </div>
              {totals && totals.discountCents > 0 && (
                <div>
                  <dt>Promo discount</dt>
                  <dd>−{formatMoney(totals.discountCents)}</dd>
                </div>
              )}
              <div>
                <dt>Delivery fee</dt>
                <dd>
                  {typeof totals?.deliveryCents === "number"
                    ? formatMoney(totals.deliveryCents)
                    : "Not configured"}
                </dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>
                  {typeof totals?.taxCents === "number"
                    ? formatMoney(totals.taxCents)
                    : "Not configured"}
                </dd>
              </div>
              {totals && (
                <div className="delivery-total">
                  <dt>Reviewed food total</dt>
                  <dd>{formatMoney(totals.totalCents)} CAD</dd>
                </div>
              )}
            </dl>
            {editing && (
              <Link className="delivery-track-link" href="/menu/">
                Add dishes →
              </Link>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function PromoField({ saved }: { saved?: string }) {
  const [value, setValue] = useState(saved ?? "");
  useEffect(() => {
    if (saved !== undefined) return;
    const frame = requestAnimationFrame(() =>
      setValue(readDeliverySession(deliveryPromoKey)),
    );
    return () => cancelAnimationFrame(frame);
  }, [saved]);
  return (
    <label className="delivery-promo">
      Promo code <small>Optional</small>
      <input
        name="promoCode"
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={24}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
}
