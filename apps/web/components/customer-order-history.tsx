import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@wok/domain";
import { API_URL, refreshCustomer } from "../lib/customer-session";
import "../styles/customer-order-history.css";

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

function OrderReceipt({ order }: { order: PickupOrder }) {
  return (
    <details className="pickup-receipt">
      <summary>
        <span className="receipt-number">
          Order #{order.number}
          <time dateTime={order.createdAt}>
            {orderDate.format(new Date(order.createdAt))}
          </time>
        </span>
        <span className="receipt-state" data-state={order.fulfillmentStatus}>
          {fulfilment[order.fulfillmentStatus] ?? "Status unavailable"}
        </span>
        <strong className="receipt-total">
          {formatMoney(order.totalCents)}
        </strong>
        <span className="receipt-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="receipt-body">
        <dl className="receipt-metadata">
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
        {order.items.length > 0 ? (
          <ul className="receipt-items" aria-label="Ordered dishes">
            {order.items.map((item, index) => (
              <li key={index}>
                <span className="receipt-quantity">{item.quantity} ×</span>
                <span>
                  {item.name}
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
        <div className="receipt-sum">
          <span>Order total (CAD)</span>
          <strong>{formatMoney(order.totalCents)}</strong>
        </div>
      </div>
    </details>
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
  const headingId = useId();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const current = result?.cursors === cursors ? result : null;
  useEffect(() => {
    const request = new AbortController();
    async function readPage() {
      try {
        const url = new URL(endpoint ?? "/v1/auth/orders", API_URL);
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
    <section className="customer-history" aria-labelledby={headingId}>
      <h2 id={headingId}>Order history</h2>
      {!current ? (
        <p role="status">Loading orders…</p>
      ) : current.error ? (
        <div role="alert">
          <p>{current.error}</p>
          <button type="button" onClick={() => setCursors([...cursors])}>
            Try again
          </button>
        </div>
      ) : (
        page && (
          <>
            {page.orders.length ? (
              <div className="receipt-list">
                {page.orders.map((order) => (
                  <OrderReceipt key={order.id} order={order} />
                ))}
              </div>
            ) : (
              <div className="history-empty">
                <h3>
                  {cursors.length === 1
                    ? "No pickup orders yet."
                    : "You’ve reached your earliest order."}
                </h3>
                {cursors.length === 1 && (
                  <>
                    <p>Orders placed with this account will appear here.</p>
                    {!endpoint && (
                      <Link className="text-link" href="/menu/">
                        Browse the menu <span aria-hidden="true">↗</span>
                      </Link>
                    )}
                  </>
                )}
              </div>
            )}
            {(cursors.length > 1 || page.nextCursor) && (
              <nav aria-label="Order history pages">
                <button
                  type="button"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
                  ← Newer orders
                </button>
                <button
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
