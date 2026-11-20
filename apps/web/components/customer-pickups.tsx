"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PickupRequestError,
  pickupStatusLabels,
  requestPickup,
  type PickupOrder,
} from "../lib/pickup";
import { refreshCustomer } from "../lib/customer-session";
import { pickupTrackingUrl } from "../lib/ordering";
import { AccountOrderCard } from "./customer-order-history";

type HistoryPage = {
  accountId: string;
  pickups: PickupOrder[];
  nextCursor: string | null;
};
type HistoryResult = {
  cursors: (string | null)[];
  refresh: number;
  page?: HistoryPage;
  error?: string;
};

export default function CustomerPickups({ accountId }: { accountId: string }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const current = result?.cursors === cursors ? result : null;
  const nextCursor = current?.page?.nextCursor;
  const refreshing = Boolean(current && current.refresh !== refresh);

  useEffect(() => {
    const request = new AbortController();
    const cursor = cursors.at(-1);
    const suffix = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
    void requestPickup<HistoryPage>(`/mine${suffix}`, {
      signal: request.signal,
    })
      .then((page) => {
        if (page.accountId !== accountId) {
          void refreshCustomer();
          throw new Error();
        }
        if (!request.signal.aborted) setResult({ cursors, refresh, page });
      })
      .catch((cause) => {
        if (request.signal.aborted) return;
        if (cause instanceof PickupRequestError && cause.status === 401)
          void refreshCustomer();
        setResult((previous) => ({
          cursors,
          refresh,
          page: previous?.cursors === cursors ? previous.page : undefined,
          error: "Pickup history is unavailable. Please try again.",
        }));
      });
    return () => request.abort();
  }, [accountId, cursors, refresh]);

  return (
    <section
      className="account-order-history"
      aria-labelledby="customer-pickups"
    >
      <header className="account-order-heading">
        <h2 id="customer-pickups">Pickup orders</h2>
        <div className="account-order-actions">
          {Boolean(current?.page?.pickups.length) && (
            <button
              className="account-order-action"
              type="button"
              disabled={refreshing}
              onClick={() => setRefresh((value) => value + 1)}
            >
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
          )}
          <Link className="account-order-action" href={pickupTrackingUrl}>
            Track with a code <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>
      {!current && (
        <p className="account-order-message" role="status">
          Loading pickup orders…
        </p>
      )}
      {current?.error && (
        <div className="account-order-message">
          <p role="alert">{current.error}</p>
          <button
            type="button"
            className="account-order-action"
            disabled={refreshing}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {current?.page?.pickups.length ? (
        <div className="account-order-list">
          {current.page.pickups.map((order) => (
            <AccountOrderCard
              key={order.id}
              reference={order.number}
              createdAt={order.createdAt}
              statusCode={order.status}
              statusLabel={
                pickupStatusLabels[order.status] ?? "Status unavailable"
              }
              items={order.items}
              subtotalCents={order.subtotalCents}
              discountCents={order.discountCents}
              totalCents={order.totalCents}
              updates={order.statusHistory?.map(({ at, status }) => ({
                at,
                label: pickupStatusLabels[status] ?? "Status updated",
              }))}
            />
          ))}
        </div>
      ) : (
        current?.page && (
          <div className="account-order-message">
            <h3>
              {cursors.length > 1
                ? "No older pickup orders."
                : "No pickup orders yet."}
            </h3>
            {cursors.length === 1 && (
            <Link className="account-order-action" href="/menu/">
                Start a pickup order <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        )
      )}
      {current?.page && (cursors.length > 1 || nextCursor) && (
        <nav className="account-order-paging" aria-label="Pickup history pages">
          {cursors.length > 1 && (
            <button
              className="account-order-action"
              type="button"
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              Newer pickups
            </button>
          )}
          {nextCursor && (
            <button
              className="account-order-action"
              type="button"
              onClick={() => setCursors([...cursors, nextCursor])}
            >
              Older pickups
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
