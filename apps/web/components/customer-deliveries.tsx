"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@wok/domain";
import {
  deliveryStages,
  requestDelivery,
  type Delivery,
} from "../lib/delivery";
import { API_URL } from "../lib/customer-session";

type Page = {
  accountId: string;
  deliveries: Delivery[];
  nextCursor: string | null;
};
const orderDate = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

export default function CustomerDeliveries({
  accountId,
  manager = false,
}: {
  accountId: string;
  manager?: boolean;
}) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [result, setResult] = useState<{
    pages: (string | null)[];
    data?: Page;
    error?: string;
  } | null>(null);
  const cursor = pages.at(-1);
  const current = result?.pages === pages ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const suffix = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
    async function load() {
      if (!manager)
        return requestDelivery<Page>(`/mine${suffix}`, {
          signal: controller.signal,
        });
      const response = await fetch(
        `${API_URL}/v1/auth/admin/customers/${accountId}/deliveries${suffix}`,
        {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("Delivery history is unavailable.");
      return response.json() as Promise<Page>;
    }
    void load()
      .then((data) => {
        if (data.accountId !== accountId)
          throw new Error("Delivery account has changed.");
        if (!controller.signal.aborted) setResult({ pages, data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            pages,
            error: "Delivery history is unavailable. Please try again.",
          });
      });
    return () => controller.abort();
  }, [accountId, manager, cursor, pages]);

  return (
    <section className="customer-history" aria-labelledby="customer-deliveries">
      <h2 id="customer-deliveries">Delivery history</h2>
      {!current ? (
        <p role="status">Loading deliveries…</p>
      ) : current.error ? (
        <>
          <p role="alert">{current.error}</p>
          <button type="button" onClick={() => setPages([...pages])}>
            Try again
          </button>
        </>
      ) : current.data?.deliveries.length ? (
        <>
          {current.data.deliveries.map((delivery) => (
            <details key={delivery.id} className="pickup-receipt">
              <summary>
                <span className="receipt-number">
                  Order {delivery.number}
                  <time dateTime={delivery.createdAt}>
                    {orderDate.format(new Date(delivery.createdAt))}
                  </time>
                </span>
                <span className="receipt-state" data-state={delivery.status}>
                  {deliveryStages.find((stage) => stage.id === delivery.status)
                    ?.label ?? "Cancelled"}
                </span>
                <strong className="receipt-total">
                  {formatMoney(delivery.totalCents)}
                </strong>
              </summary>
              <ul className="receipt-items">
                {delivery.items.map((item, index) => (
                  <li key={index}>
                    <span>
                      {item.quantity} × {item.name}
                      {item.modifiers.length > 0 && (
                        <small>{item.modifiers.join(" · ")}</small>
                      )}
                    </span>
                    <strong>{formatMoney(item.lineTotalCents)}</strong>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <div className="delivery-actions">
            {pages.length > 1 && (
              <button
                type="button"
                onClick={() => setPages(pages.slice(0, -1))}
              >
                Newer deliveries
              </button>
            )}
            {current.data.nextCursor && (
              <button
                type="button"
                onClick={() =>
                  setPages([...pages, current.data?.nextCursor ?? null])
                }
              >
                Older deliveries
              </button>
            )}
          </div>
        </>
      ) : (
        <p>
          {manager
            ? "This customer has no linked delivery orders."
            : "Delivery orders placed while signed in will appear here."}
        </p>
      )}
      {!manager && (
        <Link className="text-link" href="/delivery/#track">
          Track with a private code <span aria-hidden="true">↗</span>
        </Link>
      )}
    </section>
  );
}
