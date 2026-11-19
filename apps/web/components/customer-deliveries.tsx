"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DomainError,
  formatMoney,
  priceLine,
  type CartSelection,
} from "@wok/domain";
import { setCart, type CartLine } from "../lib/cart-store";
import {
  deliveryStages,
  requestDelivery,
  type Delivery,
} from "../lib/delivery";
import { API_URL } from "../lib/customer-session";
import { getMenuCatalogSnapshot } from "../lib/menu-catalog";

type Page = {
  accountId: string;
  deliveries: Delivery[];
  nextCursor: string | null;
};
const orderDate = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

function ReorderDelivery({
  delivery,
  accountId,
}: {
  delivery: Delivery;
  accountId: string;
}) {
  const request = useRef<AbortController | null>(null);
  const reviewLink = useRef<HTMLAnchorElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [added, setAdded] = useState(false);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (added) reviewLink.current?.focus({ preventScroll: true });
  }, [added]);

  async function reorder() {
    if (request.current || added) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setMessage("");
    try {
      const result = await requestDelivery<{
        accountId: string;
        selections: CartSelection[];
        unavailable: number;
      }>(`/${delivery.id}/reorder`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.accountId !== accountId)
        throw new Error("Sign in to reorder this delivery.");
      const catalog = getMenuCatalogSnapshot();
      const available = result.selections.flatMap(
        ({ itemId, quantity, modifierIds }) => {
          const selection = { itemId, quantity, modifierIds };
          try {
            priceLine(selection, catalog);
            return [{ ...selection, key: crypto.randomUUID() }];
          } catch (error) {
            if (!(error instanceof DomainError)) throw error;
            return [];
          }
        },
      );
      if (!available.length)
        throw new Error(
          "The choices in this delivery are no longer available.",
        );
      setCart((current: CartLine[]) => {
        if (current.length + available.length > 40)
          throw new Error(
            "Your bag can hold up to 40 selections. Make room before adding this order.",
          );
        return [...current, ...available];
      });
      const unavailable =
        result.unavailable + result.selections.length - available.length;
      setAdded(true);
      setMessage(
        unavailable
          ? `Available items added. ${unavailable} unavailable selection${unavailable === 1 ? " was" : "s were"} left out.`
          : "Items added to your bag.",
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error && !(error instanceof TypeError)
            ? error.message
            : "We couldn’t add these items. Try again.",
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <div className="delivery-reorder">
      <div className="delivery-actions">
        {added ? (
          <Link className="text-link" href="/delivery/" ref={reviewLink}>
            Review for delivery <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => void reorder()}
          >
            {pending ? "Checking the menu…" : "Add to your bag again"}
          </button>
        )}
      </div>
      <p role="status">{message}</p>
    </div>
  );
}

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
              <div className="receipt-body">
                <ul className="receipt-items receipt-items--delivery">
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
                {!manager && (
                  <ReorderDelivery delivery={delivery} accountId={accountId} />
                )}
              </div>
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
