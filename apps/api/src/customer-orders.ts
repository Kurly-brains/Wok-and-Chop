import { BadRequestException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

type ReceiptLine = {
  name: string;
  quantity: number;
  modifiers: string[];
  lineTotalCents: number | null;
};

type OrderRow = {
  id: string;
  number: string;
  createdAt: Date;
  pickupAt: Date | null;
  fulfillmentStatus: string;
  paymentStatus: string;
  totalCents: string;
  lines: unknown[];
};

function receiptLine(value: unknown): ReceiptLine[] {
  if (!value || typeof value !== "object") return [];
  const line = value as Record<string, unknown>;
  if (
    typeof line.name !== "string" ||
    !line.name.trim() ||
    typeof line.quantity !== "number" ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1
  )
    return [];
  const modifiers = Array.isArray(line.modifiers)
    ? line.modifiers.flatMap((modifier) => {
        const name = typeof modifier === "string" ? modifier : modifier?.name;
        return typeof name === "string" && name.trim() ? [name] : [];
      })
    : [];
  return [
    {
      name: line.name,
      quantity: line.quantity,
      modifiers,
      lineTotalCents:
        typeof line.lineTotalCents === "number" &&
        Number.isSafeInteger(line.lineTotalCents) &&
        line.lineTotalCents >= 0
          ? line.lineTotalCents
          : null,
    },
  ];
}

// The caller obtains the account ID from an authenticated session. Both the
// cursor lookup and the result set use that same owner boundary.
export async function fetchCustomerOrders(
  db: Pool | PoolClient,
  accountId: string,
  after?: unknown,
) {
  if (
    after !== undefined &&
    (typeof after !== "string" ||
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(after))
  ) {
    throw new BadRequestException("Invalid order history cursor.");
  }
  const pageSize = 10;
  const { rows } = await db.query<OrderRow>(
    `SELECT o.id, o.display_number::text AS number, o.created_at AS "createdAt",
            o.pickup_at AS "pickupAt", o.fulfillment_status AS "fulfillmentStatus",
            o.payment_status AS "paymentStatus", r.total_cents::text AS "totalCents", r.lines
       FROM orders o JOIN order_revisions r ON r.order_id = o.id AND r.revision = o.active_revision
      WHERE o.customer_account_id = $1
        AND ($2::uuid IS NULL OR (o.created_at, o.id) < (
          SELECT c.created_at, c.id FROM orders c WHERE c.id = $2 AND c.customer_account_id = $1
        ))
      ORDER BY o.created_at DESC, o.id DESC LIMIT $3`,
    [accountId, after ?? null, pageSize + 1],
  );
  const orders = rows
    .slice(0, pageSize)
    .map(({ lines, totalCents, ...order }) => {
      const amount = Number(totalCents);
      if (!Number.isSafeInteger(amount))
        throw new Error("Order total exceeds supported receipt precision.");
      return {
        ...order,
        totalCents: amount,
        items: lines.flatMap(receiptLine),
      };
    });
  return {
    accountId,
    orders,
    nextCursor: rows.length > pageSize ? orders[pageSize - 1].id : null,
  };
}
