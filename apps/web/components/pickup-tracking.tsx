"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { uberEatsUrl } from "../lib/ordering";
import {
  PickupRequestError,
  pickupStatusLabels,
  pickupTrackingCode,
  pickupTrackingKey,
  readPickupSession,
  requestPickup,
  writePickupSession,
  type PickupOrder,
  type PickupStatus,
} from "../lib/pickup";
import { PickupOrderSummary } from "./pickup-details";
import OrderStatusCharacter from "./order-status-character";
import "../styles/pickup-tracking.css";

const stages = [
  "RECEIVED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
] as const;
const timestamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const nextStep: Record<PickupStatus, string> = {
  RECEIVED:
    "Wok & Chop has your request. We’ll update this page when the kitchen starts preparing it.",
  PREPARING:
    "The kitchen is making your order. This page will show when it’s ready to collect.",
  READY_FOR_PICKUP:
    "Bring your order number and pay at the counter when you collect.",
  PICKED_UP:
    "Your order has been collected. Call the restaurant if you have a question.",
  CANCELLED: "Call the restaurant if you need help with this order.",
};
const directionsUrl =
  "https://www.google.com/maps/dir/?api=1&destination=790%20Kanata%20Ave%20Unit%20M2A%2C%20Kanata%20ON";

type Result = { order: PickupOrder; token: string; checkedAt: Date };

function formatTimestamp(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timestamp.format(date);
}

function PickupTimeline({ order }: { order: PickupOrder }) {
  const history = order.statusHistory ?? [];
  const times = new Map(history.map((entry) => [entry.status, entry.at]));
  if (!times.has("RECEIVED")) times.set("RECEIVED", order.createdAt);
  if (!times.has(order.status)) times.set(order.status, order.updatedAt);
  const cancelled = order.status === "CANCELLED";
  const lastProgress = history.findLast(
    ({ status }) => status !== "CANCELLED",
  )?.status;
  const lastStage = stages.findIndex((stage) => stage === lastProgress);
  const steps: readonly PickupStatus[] = cancelled
    ? [...stages.slice(0, Math.max(lastStage, 0) + 1), "CANCELLED"]
    : stages;
  const current = steps.indexOf(order.status);

  return (
    <ol className="pickup-tracking-timeline" aria-label="Pickup progress">
      {steps.map((step, index) => {
        const at = index <= current ? times.get(step) : undefined;
        const detail = formatTimestamp(at);
        return (
          <li
            key={step}
            aria-current={index === current ? "step" : undefined}
            data-stage={step}
            data-progress={
              index === current
                ? "current"
                : index < current
                  ? "complete"
                  : "upcoming"
            }
          >
            <span className="pickup-tracking-segment" aria-hidden="true" />
            <strong>{pickupStatusLabels[step]}</strong>
            {detail && <time dateTime={at}>{detail}</time>}
          </li>
        );
      })}
    </ol>
  );
}

export default function PickupTracking() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const focusReceipt = useRef(false);
  const focusCode = useRef(false);

  const lookup = useCallback(
    async (
      token: string,
      source: "form" | "saved" | "refresh" | "background",
    ) => {
      if (request.current) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15000),
      ]);
      request.current = controller;
      if (source !== "background") setBusy(true);
      try {
        const { pickup } = await requestPickup<{ pickup: PickupOrder }>(
          "/track",
          {
            method: "POST",
            body: JSON.stringify({ trackingToken: token }),
            signal,
          },
        );
        if (controller.signal.aborted) return;
        if (
          !pickup?.number ||
          !Object.hasOwn(pickupStatusLabels, pickup.status)
        )
          throw new Error("Invalid pickup");
        if (source === "form") focusReceipt.current = true;
        setResult((current) =>
          current?.order.id === pickup.id &&
          current.order.version > pickup.version
            ? current
            : { order: pickup, token, checkedAt: new Date() },
        );
        setCode("");
        setError("");
        writePickupSession(pickupTrackingKey, token);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof PickupRequestError && cause.status === 404) {
          setResult(null);
          if (readPickupSession(pickupTrackingKey) === token)
            writePickupSession(pickupTrackingKey, "");
          setError(
            "Order not found. Check the private code from your pickup confirmation.",
          );
        } else {
          setError(
            source === "refresh" || source === "background"
              ? "Couldn’t refresh. The last checked status is still shown."
              : "Pickup tracking is temporarily unavailable. Try again or call the restaurant.",
          );
        }
      } finally {
        if (request.current === controller) {
          request.current = null;
          setBusy(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const saved = readPickupSession(pickupTrackingKey);
    const timer = window.setTimeout(() => {
      if (pickupTrackingCode.test(saved)) {
        setCode(saved);
        void lookup(saved, "saved");
      } else {
        setBusy(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [lookup]);

  const progressToken =
    result &&
    result.order.status !== "CANCELLED" &&
    result.order.status !== "PICKED_UP"
      ? result.token
      : "";
  useEffect(() => {
    if (!progressToken) return;
    const refresh = () => {
      if (!document.hidden) void lookup(progressToken, "background");
    };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [lookup, progressToken]);

  useEffect(() => {
    if (result && focusReceipt.current) {
      focusReceipt.current = false;
      receiptHeading.current?.focus();
    }
    if (!result && focusCode.current) {
      focusCode.current = false;
      codeInput.current?.focus();
    }
  }, [result]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = code.trim().toLowerCase();
    if (!pickupTrackingCode.test(token)) {
      setError(
        "Enter the full private tracking code from your pickup confirmation.",
      );
      codeInput.current?.focus();
      return;
    }
    setError("");
    void lookup(token, "form");
  }

  function trackAnother() {
    request.current?.abort();
    request.current = null;
    focusCode.current = true;
    writePickupSession(pickupTrackingKey, "");
    setBusy(false);
    setError("");
    setCode("");
    setResult(null);
  }

  return (
    <section
      className="pickup-tracking"
      aria-labelledby="pickup-tracking-title"
    >
      <div className="pickup-tracking-toolbar">
        <Link className="pickup-tracking-text" href="/account/">
          <span aria-hidden="true">←</span> Account
        </Link>
        {result && (
          <button
            className="pickup-tracking-text"
            type="button"
            onClick={trackAnother}
          >
            Track another pickup
          </button>
        )}
      </div>
      {result ? (
        <>
          <header className="pickup-tracking-hero">
            <OrderStatusCharacter status={result.order.status} />
            <p className="pickup-tracking-reference">
              Order {result.order.number}
            </p>
            <h1
              id="pickup-tracking-title"
              ref={receiptHeading}
              tabIndex={-1}
              aria-live="polite"
            >
              {pickupStatusLabels[result.order.status]}
            </h1>
            <p className="pickup-tracking-description">
              {nextStep[result.order.status]}
            </p>
            <PickupTimeline order={result.order} />
            <div className="pickup-tracking-meta">
              <p>
                Last checked{" "}
                <time dateTime={result.checkedAt.toISOString()}>
                  {timestamp.format(result.checkedAt)}
                </time>
                <span className="pickup-tracking-timezone">
                  {" "}
                  · Toronto time
                </span>
              </p>
              <button
                className="pickup-tracking-submit"
                type="button"
                disabled={busy}
                onClick={() => void lookup(result.token, "refresh")}
              >
                <span aria-hidden="true">↻</span>{" "}
                {busy ? "Checking…" : "Refresh status"}
              </button>
            </div>
            {error && (
              <p className="pickup-tracking-error" role="status">
                {error}
              </p>
            )}
          </header>
          <div className="pickup-tracking-details">
            <PickupOrderSummary totals={result.order} reviewed />
            <section
              className="pickup-tracking-location"
              aria-labelledby="pickup-tracking-location"
            >
              <h2 id="pickup-tracking-location">Pickup location</h2>
              <strong>Wok &amp; Chop</strong>
              <address>
                790 Kanata Ave, Unit M2A
                <br />
                Kanata, ON
              </address>
              <div className="pickup-tracking-location-actions">
                <a
                  className="pickup-tracking-text"
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get directions <span aria-hidden="true">↗</span>
                </a>
                <a className="pickup-tracking-text" href="tel:+16135911111">
                  Call restaurant
                </a>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="pickup-tracking-lookup">
          <h1 id="pickup-tracking-title">Track your pickup</h1>
          <p
            className="pickup-tracking-description"
            id="pickup-tracking-code-help"
          >
            Use the private code from your Wok &amp; Chop pickup confirmation.
          </p>
          <form
            className="pickup-tracking-form"
            method="post"
            onSubmit={submit}
          >
            <label htmlFor="pickup-tracking-code">Private tracking code</label>
            <input
              id="pickup-tracking-code"
              ref={codeInput}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setError("");
              }}
              aria-describedby="pickup-tracking-code-help"
              aria-invalid={Boolean(error)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={80}
              required
              disabled={busy}
            />
            {error && (
              <p className="pickup-tracking-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="pickup-tracking-submit"
              type="submit"
              disabled={busy}
            >
              {busy ? "Checking…" : "Find my order"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>
      )}
      <p className="pickup-tracking-partner">
        Ordered through Uber Eats?{" "}
        <a href={uberEatsUrl}>
          Open Uber Eats <span aria-hidden="true">↗</span>
        </a>
      </p>
    </section>
  );
}
