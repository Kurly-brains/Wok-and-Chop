import Link from "next/link";
import { formatMoney } from "@wok/domain";
import type { PickupTotal } from "../lib/pickup";
import "../styles/pickup.css";

export function PickupLocation() {
  return (
    <div className="pickup-location">
      <strong>Wok &amp; Chop</strong>
      <address>790 Kanata Ave, Unit M2A, Kanata, ON</address>
      <Link href="/contact/">Directions <span aria-hidden="true">↗</span></Link>
    </div>
  );
}

export function PickupOrderSummary({ totals, reviewed }: { totals: PickupTotal; reviewed: boolean }) {
  return (
    <aside className="pickup-card pickup-summary" aria-labelledby="pickup-summary">
      <h2 id="pickup-summary">Your order</h2>
      <ul>
        {totals.items.map((item, index) => (
          <li key={index}>
            <div>
              <strong>{item.quantity} × {item.name}</strong>
              {item.modifiers.length > 0 && <small>{item.modifiers.join(" · ")}</small>}
            </div>
            <span>{formatMoney(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <dl>
        <div><dt>Food subtotal</dt><dd>{formatMoney(totals.subtotalCents)}</dd></div>
        {totals.discountCents > 0 && (
          <div><dt>Discount</dt><dd>−{formatMoney(totals.discountCents)}</dd></div>
        )}
        {totals.taxCents !== null && (
          <div><dt>Tax</dt><dd>{formatMoney(totals.taxCents)}</dd></div>
        )}
        <div className="pickup-total">
          <dt>{reviewed && totals.taxCents !== null ? "Total" : "Food total"}</dt>
          <dd>{formatMoney(totals.totalCents)} <small>CAD</small></dd>
        </div>
      </dl>
      {totals.taxCents === null && <p className="pickup-note">Any applicable tax is calculated at the restaurant.</p>}
    </aside>
  );
}
