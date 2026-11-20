"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DomainError, priceLine, type CartSelection } from "@wok/domain";
import { setCart, type CartLine } from "../lib/cart-store";
import {
  DeliveryRequestError,
  deliveryStages,
  requestDelivery,
  type Delivery,
} from "../lib/delivery";
import { API_URL, refreshCustomer } from "../lib/customer-session";
import { getMenuCatalogSnapshot } from "../lib/menu-catalog";
import { pickupCheckoutUrl } from "../lib/ordering";
import { AccountOrderCard } from "./customer-order-history";

type Page = {
  accountId: string;
  deliveries: Delivery[];
  nextCursor: string | null;
};
function deliveryLabel(status: string) {
  return status === "CANCELLED"
    ? "Cancelled"
    : (deliveryStages.find((stage) => stage.id === status)?.label ??
        "Status unavailable");
}

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
    <div className="account-order-reorder">
      <div>
        {added ? (
          <Link
            className="account-order-action"
            href={pickupCheckoutUrl}
            ref={reviewLink}
          >
            Review for pickup <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <button
            type="button"
            className="account-order-action"
            disabled={pending}
            onClick={() => void reorder()}
          >
            {pending ? "Checking the menu…" : "Add these dishes for pickup"}
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
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (
          !manager &&
          error instanceof DeliveryRequestError &&
          error.status === 401
        )
          void refreshCustomer();
        setResult({
          pages,
          error: "Delivery history is unavailable. Please try again.",
        });
      });
    return () => controller.abort();
  }, [accountId, manager, cursor, pages]);

  return (
    <section
      className="account-order-history"
      aria-labelledby="customer-deliveries"
    >
      <header className="account-order-heading">
        <h2 id="customer-deliveries">
          {manager ? "Delivery history" : "Earlier deliveries"}
        </h2>
        {!manager && (
          <Link
            className="account-order-action"
            href="/delivery/tracking/#track"
          >
            Track with a code <span aria-hidden="true">→</span>
          </Link>
        )}
      </header>
      {!current ? (
        <p className="account-order-message" role="status">
          Loading deliveries…
        </p>
      ) : current.error ? (
        <div className="account-order-message">
          <p role="alert">{current.error}</p>
          <button
            type="button"
            className="account-order-action"
            onClick={() => setPages([...pages])}
          >
            Try again
          </button>
        </div>
      ) : current.data?.deliveries.length ? (
        <div className="account-order-list">
          {current.data.deliveries.map((delivery) => (
            <AccountOrderCard
              key={delivery.id}
              reference={delivery.number}
              createdAt={delivery.createdAt}
              statusCode={delivery.status}
              statusLabel={deliveryLabel(delivery.status)}
              items={delivery.items}
              subtotalCents={delivery.subtotalCents}
              discountCents={delivery.discountCents}
              totalCents={delivery.totalCents}
              updates={delivery.statusHistory?.map(({ at, status }) => ({
                at,
                label: deliveryLabel(status),
              }))}
            >
              {!manager && (
                <ReorderDelivery delivery={delivery} accountId={accountId} />
              )}
            </AccountOrderCard>
          ))}
        </div>
      ) : (
        <div className="account-order-message">
          <h3>
            {pages.length > 1
              ? "No older delivery orders."
              : "No earlier deliveries."}
          </h3>
          {!manager && pages.length === 1 && (
            <p>Past delivery orders linked to your account appear here.</p>
          )}
        </div>
      )}
      {current?.data && (pages.length > 1 || current.data.nextCursor) && (
        <nav
          className="account-order-paging"
          aria-label="Delivery history pages"
        >
          {pages.length > 1 && (
            <button
              className="account-order-action"
              type="button"
              onClick={() => setPages(pages.slice(0, -1))}
            >
              Newer deliveries
            </button>
          )}
          {current.data.nextCursor && (
            <button
              className="account-order-action"
              type="button"
              onClick={() =>
                setPages([...pages, current.data?.nextCursor ?? null])
              }
            >
              Older deliveries
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
