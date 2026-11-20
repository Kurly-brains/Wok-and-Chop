"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { formatMoney } from "@wok/domain";
import { API_URL, refreshCustomer } from "../lib/customer-session";
import OrderStatusCharacter from "./order-status-character";
import "../styles/account-orders.css";

type ReceiptItem = {
  name: string;
  quantity: number;
  modifiers: string[];
  lineTotalCents: number | null;
};
type PickupOrder = {
  id: string;
  number: string;
  createdAt: string;
  pickupAt: string | null;
  fulfillmentStatus: string;
  paymentStatus: string;
  totalCents: number;
  items: ReceiptItem[];
};
type HistoryPage = {
  accountId: string;
  orders: PickupOrder[];
  nextCursor: string | null;
};
type QueryResult = {
  cursors: (string | null)[];
  page?: HistoryPage;
  error?: string;
};

const orderDate = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});
const pickupTime = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});
const fulfilment: Record<string, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  ACCEPTED: "Accepted",
  SCHEDULED: "Scheduled",
  IN_PREPARATION: "In the kitchen",
  READY: "Ready for pickup",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXCEPTION: "Needs attention",
};
const payment: Record<string, string> = {
  UNPAID: "Unpaid",
  PROCESSING: "Processing",
  PAID: "Paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

type AccountOrderCardProps = {
  reference: string;
  createdAt: string;
  statusCode: string;
  statusLabel: string;
  items: ReceiptItem[];
  totalCents: number;
  subtotalCents?: number;
  discountCents?: number;
  totalLabel?: "Order total" | "Food total";
  updates?: { at: string; label: string }[];
  metadata?: ReactNode;
  children?: ReactNode;
};

export function AccountOrderCard({
  reference,
  createdAt,
  statusCode,
  statusLabel,
  items,
  totalCents,
  subtotalCents,
  discountCents = 0,
  totalLabel = "Food total",
  updates,
  metadata,
  children,
}: AccountOrderCardProps) {
  const quantity = items.reduce((count, item) => count + item.quantity, 0);
  const hasDiscount = discountCents > 0 && subtotalCents !== undefined;

  return (
    <details className="account-order-card">
      <summary>
        <span className="account-order-reference">
          <strong>Order {reference}</strong>
          <small>
            <time dateTime={createdAt}>
              {orderDate.format(new Date(createdAt))}
            </time>
            {quantity > 0 && (
              <>
                {" "}
                <span aria-hidden="true">·</span> {quantity}{" "}
                {quantity === 1 ? "item" : "items"}
              </>
            )}
          </small>
        </span>
        <span className="account-order-status" data-state={statusCode}>
          <OrderStatusCharacter status={statusCode} />
          <span>{statusLabel}</span>
        </span>
        <span className="account-order-summary-total">
          <small>{totalLabel}</small>
          <strong>{formatMoney(totalCents)}</strong>
        </span>
        <span className="account-order-toggle">
          <span className="account-order-view">View details</span>
          <span className="account-order-hide">Hide details</span>
          <span className="account-order-chevron" aria-hidden="true" />
        </span>
      </summary>
      <div className="account-order-body">
        {metadata}
        <div className="account-order-details">
          <div>
            <h3>Items</h3>
            {items.length > 0 ? (
              <ul className="account-order-items" aria-label="Ordered dishes">
                {items.map((item, index) => (
                  <li key={index}>
                    <span className="account-order-quantity">
                      {item.quantity} ×
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      {item.modifiers.length > 0 && (
                        <small>{item.modifiers.join(" · ")}</small>
                      )}
                    </span>
                    {item.lineTotalCents !== null && (
                      <span>{formatMoney(item.lineTotalCents)}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Item details are unavailable for this order.</p>
            )}
            <dl className="account-order-totals">
              {hasDiscount && (
                <>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{formatMoney(subtotalCents)}</dd>
                  </div>
                  <div>
                    <dt>Discount</dt>
                    <dd>−{formatMoney(discountCents)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>{totalLabel}</dt>
                <dd>{formatMoney(totalCents)}</dd>
              </div>
            </dl>
          </div>
          {Boolean(updates?.length) && (
            <div className="account-order-updates">
              <h3>Order updates</h3>
              <ol>
                {updates?.map(({ at, label }, index) => (
                  <li key={index}>
                    <strong>{label}</strong>
                    <time dateTime={at}>{pickupTime.format(new Date(at))}</time>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        {children}
      </div>
    </details>
  );
}

function OrderReceipt({ order }: { order: PickupOrder }) {
  return (
    <AccountOrderCard
      reference={`#${order.number}`}
      createdAt={order.createdAt}
      statusCode={order.fulfillmentStatus}
      statusLabel={fulfilment[order.fulfillmentStatus] ?? "Status unavailable"}
      items={order.items}
      totalCents={order.totalCents}
      totalLabel="Order total"
      metadata={
        <dl className="account-order-metadata">
          <div>
            <dt>Payment</dt>
            <dd>{payment[order.paymentStatus] ?? "Status unavailable"}</dd>
          </div>
          <div>
            <dt>Pickup in Kanata</dt>
            <dd>
              {order.pickupAt ? (
                <time dateTime={order.pickupAt}>
                  {pickupTime.format(new Date(order.pickupAt))}
                </time>
              ) : (
                "Time not recorded"
              )}
            </dd>
          </div>
        </dl>
      }
    />
  );
}

type HistoryProps = { accountId: string; endpoint?: string };
export default function CustomerOrderHistory(props: HistoryProps) {
  return (
    <OrderHistoryPages
      key={JSON.stringify([props.accountId, props.endpoint])}
      {...props}
    />
  );
}

function OrderHistoryPages({ accountId, endpoint }: HistoryProps) {
  const internalId = useId();
  const headingId = endpoint ? internalId : "customer-earlier-orders";
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const current = result?.cursors === cursors ? result : null;
  useEffect(() => {
    const request = new AbortController();
    async function readPage() {
      try {
        const url = new URL(
          API_URL + (endpoint ?? "/v1/auth/orders"),
          window.location.origin,
        );
        const after = cursors.at(-1);
        if (after) url.searchParams.set("after", after);
        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          signal: request.signal,
        });
        if (response.status === 401) {
          void refreshCustomer();
          throw new Error();
        }
        if (!response.ok) throw new Error();
        const page: HistoryPage = await response.json();
        if (page.accountId !== accountId) {
          if (!endpoint) void refreshCustomer();
          throw new Error();
        }
        if (!Array.isArray(page.orders)) throw new Error();
        if (!request.signal.aborted) setResult({ cursors, page });
      } catch {
        if (!request.signal.aborted)
          setResult({
            cursors,
            error: "Order history is unavailable. Please try again.",
          });
      }
    }
    void readPage();
    return () => request.abort();
  }, [accountId, cursors, endpoint]);

  const page = current?.page;
  return (
    <section className="account-order-history" aria-labelledby={headingId}>
      <header className="account-order-heading">
        <h2 id={headingId}>
          {endpoint ? "Order history" : "Earlier pickup receipts"}
        </h2>
      </header>
      {!current ? (
        <p className="account-order-message" role="status">
          Loading orders…
        </p>
      ) : current.error ? (
        <div className="account-order-message">
          <p role="alert">{current.error}</p>
          <button
            type="button"
            className="account-order-action"
            onClick={() => setCursors([...cursors])}
          >
            Try again
          </button>
        </div>
      ) : (
        page && (
          <>
            {page.orders.length ? (
              <div className="account-order-list">
                {page.orders.map((order) => (
                  <OrderReceipt key={order.id} order={order} />
                ))}
              </div>
            ) : (
              <div className="account-order-message">
                <h3>
                  {cursors.length === 1
                    ? "No earlier pickup receipts."
                    : "You’ve reached your earliest order."}
                </h3>
              </div>
            )}
            {(cursors.length > 1 || page.nextCursor) && (
              <nav
                className="account-order-paging"
                aria-label="Order history pages"
              >
                <button
                  className="account-order-action"
                  type="button"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
                  ← Newer orders
                </button>
                <button
                  className="account-order-action"
                  type="button"
                  disabled={!page.nextCursor}
                  onClick={() => {
                    if (page.nextCursor)
                      setCursors([...cursors, page.nextCursor]);
                  }}
                >
                  Older orders →
                </button>
              </nav>
            )}
          </>
        )
      )}
    </section>
  );
}
