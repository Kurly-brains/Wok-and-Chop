"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatMoney } from "@wok/domain";
import {
  DeliveryRequestError,
  deliveryEventTime,
  deliveryStages,
  guestReceiptKey,
  readDeliverySession,
  requestDelivery,
  saveDeliverySession,
  type Delivery,
  type DeliveryStatusEvent,
} from "../lib/delivery";
import { uberEatsUrl } from "../lib/ordering";
import "../styles/delivery.css";

function DeliveryProgress({
  status,
  history = [],
}: {
  status: Delivery["status"];
  history?: DeliveryStatusEvent[];
}) {
  const current = deliveryStages.findIndex((stage) => stage.id === status);
  const times = new Map(history.map((event) => [event.status, event.at]));
  const cancelled = status === "CANCELLED";
  const stages = cancelled
    ? [
        ...deliveryStages.filter((stage) => times.has(stage.id)),
        { id: "CANCELLED" as const, label: "Cancelled" },
      ]
    : deliveryStages;
  return (
    <ol className="delivery-progress" aria-label="Delivery progress">
      {stages.map((stage, index) => {
        const time = times.get(stage.id);
        return (
          <li
            key={stage.id}
            data-done={cancelled || index <= current}
            data-cancelled={stage.id === "CANCELLED" || undefined}
            aria-current={stage.id === status ? "step" : undefined}
          >
            {stage.label}
            {time && (
              <time dateTime={time}>{deliveryEventTime.format(new Date(time))}</time>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function TrackDelivery() {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [trackingToken, setTrackingToken] = useState("");
  const [message, setMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [trackingOffline, setTrackingOffline] = useState(false);
  const activeToken = useRef("");
  const manualLookup = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const refresh = () => {
      if (document.hidden || refreshing) return;
      const savedToken =
        activeToken.current || readDeliverySession(guestReceiptKey);
      if (!savedToken) return;
      refreshing = true;
      const lookup = manualLookup.current;
      void requestDelivery<{ delivery: Delivery }>("/track", {
        method: "POST",
        body: JSON.stringify({ trackingToken: savedToken }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      })
        .then(({ delivery }) => {
          if (
            controller.signal.aborted ||
            manualLookup.current !== lookup ||
            (activeToken.current && activeToken.current !== savedToken)
          )
            return;
          activeToken.current = savedToken;
          setTrackingToken((token) => token || savedToken);
          setTrackingOffline(false);
          setDelivery((current) =>
            current?.id === delivery.id && (
              current.version > delivery.version ||
              (current.version === delivery.version && current.statusHistory)
            )
              ? current
              : delivery,
          );
        })
        .catch(() => {
          if (!controller.signal.aborted && manualLookup.current === lookup && activeToken.current === savedToken)
            setTrackingOffline(true);
        })
        .finally(() => {
          refreshing = false;
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
    manualLookup.current += 1;
    setPending(true);
    setMessage("");
    setCopyStatus("");
    const token = trackingToken.trim().toLowerCase();
    try {
      const result = await requestDelivery<{ delivery: Delivery }>("/track", {
        method: "POST",
        body: JSON.stringify({ trackingToken: token }),
        signal: AbortSignal.timeout(10000),
      });
      activeToken.current = token;
      setDelivery((current) =>
        current?.id === result.delivery.id && current.version > result.delivery.version
          ? current
          : result.delivery,
      );
      setTrackingOffline(false);
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
          <DeliveryProgress status={delivery.status} history={delivery.statusHistory} />
          <p className="delivery-caption">
            {trackingOffline
              ? "Showing the latest available status. Reconnecting for updates."
              : "Times are shown in Toronto time."}
          </p>
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

export default function LegacyDeliveryTracking() {
  return (
    <div className="wc-delivery wc-legacy-delivery">
      <header className="wc-legacy-delivery-heading">
        <Link href="/order/">← Order online</Link>
        <h1>Past delivery orders</h1>
        <p>Use your Wok &amp; Chop tracking code below. For Uber Eats orders, check <a href={uberEatsUrl}>Uber Eats</a>.</p>
      </header>
      <TrackDelivery />
    </div>
  );
}
