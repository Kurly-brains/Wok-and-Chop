"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { formatMoney } from "@wok/domain";
import { authRequest, useCustomer } from "../../lib/customer-session";
import {
  nextAction, restaurantClock, restaurantDate, statusNames, useManagerDeliveries,
  type DeliveryStatus, type ManagerDelivery, type ManagerQueue,
} from "../../lib/manager-deliveries";
import { DeliverySlipTools } from "./DeliverySlipTools";
import { ManagerSignIn } from "./ManagerSignIn";
import { OperationsShell } from "./OperationsShell";
import "../../styles/delivery-operations.css";

type Screen = "staff" | "kitchen";
const activeStages = ["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY"] as const;
const kitchenNames = { RECEIVED: "Incoming", PREPARING: "Preparing", OUT_FOR_DELIVERY: "With driver" };
function stamp(iso: string) {
  const date = new Date(iso);
  return restaurantDate.format(date) + " · " + restaurantClock.format(date);
}

function Stage({ status }: { status: DeliveryStatus }) {
  return <span className={"delivery-stage stage-" + status.toLowerCase()}>{statusNames[status]}</span>;
}

function LoginPanel({ screen, onSignedIn }: { screen: Screen; onSignedIn?: () => void }) {
  return <div className="ops-lockup">
    <div className="ops-lockup-form"><ManagerSignIn
      description={screen === "staff" ? "Sign in to manage delivery requests, contact customers and record handoffs." : "Sign in to view incoming dishes, preparation notes and driver handoffs."}
      onSignedIn={onSignedIn} />
      <Link className="ops-training-link" href={screen === "staff" ? "/staff/training/" : "/kitchen/training/"}>Open the training {screen === "staff" ? "board" : "kitchen"} <span aria-hidden="true">↗</span></Link>
    </div>
    <figure className="ops-lockup-art" aria-hidden="true"><img src={screen === "staff" ? "/images/art/kanata-table.webp" : "/images/art/wok-kitchen.webp"} alt="" width="1200" height="800" /></figure>
  </div>;
}

function Items({ order, prices }: { order: ManagerDelivery; prices?: boolean }) {
  return <ul className="delivery-items">{order.items.map((item, index) => <li key={index}>
    <span className="delivery-qty" aria-label={"Quantity " + item.quantity}>{item.quantity}×</span>
    <div><strong>{item.name}</strong>{item.modifiers.length > 0 && <p>{item.modifiers.join(" · ")}</p>}
      {item.note && <p className="delivery-item-note"><b>Kitchen note</b> {item.note}</p>}</div>
    {prices && <span>{formatMoney(item.lineTotalCents)}</span>}
  </li>)}</ul>;
}

function Actions({ order, queue, kitchen = false }: { order: ManagerDelivery; queue: ManagerQueue; kitchen?: boolean }) {
  const [cancel, setCancel] = useState(false);
  const action = nextAction[order.status];
  const canCancel = !kitchen && (order.status === "RECEIVED" || order.status === "PREPARING");
  if (!action || (kitchen && order.status === "OUT_FOR_DELIVERY")) return null;
  if (cancel && canCancel) return <div className="delivery-confirm" role="group" aria-label="Confirm cancellation">
    <strong>Cancel {order.number}?</strong><p>Cancellation removes this request from the active delivery queue.</p>
    <button className="ops-button" disabled={queue.saving} onClick={() => void queue.transition(order, "CANCELLED")}>Confirm cancellation</button>
    <button className="ops-text-button" onClick={() => setCancel(false)}>Keep order</button>
  </div>;
  return <div className="delivery-actions">
    <button className="ops-button" disabled={queue.saving} onClick={() => void queue.transition(order, action.status)}>{action.title} <span aria-hidden="true">→</span></button>
    {canCancel && <button className="ops-text-button" disabled={queue.saving} onClick={() => setCancel(true)}>Cancel request</button>}
  </div>;
}

function Details({ order, queue }: { order: ManagerDelivery; queue: ManagerQueue }) {
  const address = order.address;
  return <>
    <div className="delivery-detail-head"><div><span>Delivery ticket</span><h2>{order.number}</h2></div><Stage status={order.status} /></div>
    <dl className="delivery-detail-meta"><div><dt>Received</dt><dd>{stamp(order.createdAt)}</dd></div><div><dt>Last update</dt><dd>{stamp(order.updatedAt)}</dd></div></dl>
    <section className="delivery-recipient"><h3>Deliver to</h3><div><strong>{order.name}</strong><a href={"tel:" + order.phone.replace(/[^\d+]/g, "")}>{order.phone}</a></div>
      <address>{address.street}{address.unit ? ", " + address.unit : ""}<br />{address.city}, {address.province} {address.postalCode}</address>
      {order.instructions && <p><b>Delivery instructions</b> {order.instructions}</p>}
    </section>
    <Items order={order} prices />
    <dl className="delivery-totals"><div><dt>Subtotal</dt><dd>{formatMoney(order.subtotalCents)}</dd></div>
      {order.discountCents > 0 && <div><dt>Discount</dt><dd>−{formatMoney(order.discountCents)}</dd></div>}
      <div><dt>Delivery fee</dt><dd>{order.deliveryCents === null ? "To be confirmed" : formatMoney(order.deliveryCents)}</dd></div>
      <div><dt>Tax</dt><dd>{order.taxCents === null ? "To be confirmed" : formatMoney(order.taxCents)}</dd></div>
      <div className="delivery-total"><dt>Food total <small>CAD</small></dt><dd>{formatMoney(order.totalCents)}</dd></div>
    </dl>
    <Actions key={order.version} order={order} queue={queue} />
    <DeliverySlipTools key={order.id} order={order} />
  </>;
}

function StaffTickets({ queue, history }: { queue: ManagerQueue; history: boolean }) {
  const [filter, setFilter] = useState<DeliveryStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [id, setId] = useState("");
  const detail = useRef<HTMLElement>(null);
  const statuses = history ? (["DELIVERED", "CANCELLED"] as const) : activeStages;
  const term = search.trim().toLowerCase().replace(/^#/, "");
  const results = queue.orders.filter(o => (filter === "all" || o.status === filter)
    && [o.number, o.name, o.phone, o.address.street, o.address.postalCode].some(field => field.toLowerCase().includes(term)));
  const selected = results.find(order => order.id === id) ?? results[0];
  return <div className="deliveries-desk">
    <section className="deliveries-list" aria-label={history ? "Delivery history" : "Active delivery orders"}>
      <div className="delivery-stage-filters" role="group" aria-label="Filter by delivery status">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <b>{queue.orders.length}</b></button>
        {statuses.map(s => <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>{statusNames[s]} <b>{queue.orders.filter(order => order.status === s).length}</b></button>)}
      </div>
      <label className="delivery-search"><span className="ops-sr-only">Search tickets on this page</span><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={history ? "Search this page of delivery history" : "Find a ticket, name or address"} /></label>
      {results.length === 0 ? <div className="delivery-empty"><h3>{queue.orders.length ? "No matching deliveries" : history ? "No delivery history yet" : "No active deliveries"}</h3>
        <p>{queue.orders.length ? "Choose another status or search term." : history ? "Delivered and cancelled requests appear here." : "New delivery requests appear here automatically."}</p></div>
      : <ul className="delivery-list-rows">{results.map(order => <li key={order.id}><button aria-pressed={selected?.id === order.id} onClick={() => {
        setId(order.id);
        if (window.matchMedia("(max-width: 760px)").matches) detail.current?.focus();
      }}>
        <span className="delivery-row-ref"><strong>{order.number}</strong><small>{stamp(order.createdAt)}</small></span>
        <span className="delivery-row-name"><b>{order.name}</b><small>{order.address.street}</small></span>
        <Stage status={order.status} />
      </button></li>)}</ul>}
    </section>
    <aside className="delivery-detail" ref={detail} tabIndex={-1} aria-label="Delivery details">{selected ? <Details key={selected.id} order={selected} queue={queue} /> :
      <div className="delivery-detail-placeholder"><span>Delivery ticket</span><p>Select a delivery to see its dishes, address and handoff details.</p></div>}</aside>
  </div>;
}

function KitchenTickets({ queue }: { queue: ManagerQueue }) {
  const sorted = [...queue.orders].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  return <div className="delivery-kds">{activeStages.map(status => {
    const orders = sorted.filter(order => order.status === status);
    return <section key={status} className={"delivery-station station-" + status.toLowerCase()} aria-label={kitchenNames[status]}>
      <header><h2>{kitchenNames[status]}</h2><span>{orders.length}</span></header>
      {!orders.length && <p className="delivery-station-empty">No tickets {status === "RECEIVED" ? "waiting" : status === "PREPARING" ? "in preparation" : "with a driver"}.</p>}
      {orders.map(order => <article key={order.id} className="delivery-kitchen-ticket" aria-label={"Delivery " + order.number}>
        <div className="delivery-detail-head"><div><span>Delivery ticket</span><h3>{order.number}</h3></div><time dateTime={order.createdAt}>{stamp(order.createdAt)}</time></div>
        <Items order={order} />
        <Actions key={order.version} kitchen order={order} queue={queue} />
      </article>)}
    </section>;
  })}</div>;
}

function Feed({ screen, history, cursor, older, newer }: { screen: Screen; history: boolean; cursor: string; older(cursor: string): void; newer(): void }) {
  const queue = useManagerDeliveries(history ? "history" : "active", cursor);
  if (queue.access === "signed-out") return <LoginPanel screen={screen} onSignedIn={() => void queue.refresh()} />;
  if (queue.access === "forbidden") return <div className="delivery-feedback"><h2>Manager access required</h2><p>Sign out and use an account authorized by the restaurant.</p></div>;
  if (queue.access === "error") return <div className="delivery-feedback" role="alert"><h2>Delivery service unavailable</h2><p>Reconnect to load the current tickets.</p><button className="ops-button" onClick={() => void queue.refresh()}>Try again</button></div>;
  if (queue.access === "loading") return <p className="delivery-feedback" role="status">Loading delivery tickets…</p>;
  return <>
    <div className="delivery-sync"><span>{queue.checked && "Updated " + restaurantClock.format(queue.checked) + " · Toronto time"}</span><button className="ops-text-button" onClick={() => void queue.refresh()}>Refresh</button></div>
    <p className="delivery-message" role="status">{queue.message}</p>
    {screen === "kitchen" ? <KitchenTickets queue={queue} /> : <StaffTickets history={history} queue={queue} />}
    {history && <nav className="delivery-pages" aria-label="History pages">
      <button className="ops-text-button" disabled={!cursor} onClick={newer}>← Newer requests</button>
      <button className="ops-text-button" disabled={!queue.nextCursor} onClick={() => queue.nextCursor && older(queue.nextCursor)}>Older requests →</button>
    </nav>}
  </>;
}

export function DeliveryWorkspace({ screen }: { screen: Screen }) {
  const user = useCustomer();
  const [history, setHistory] = useState(false);
  const [cursors, setCursors] = useState([""]);
  const [logoutError, setLogoutError] = useState("");
  const kitchen = screen === "kitchen";
  const cursor = history ? cursors[cursors.length - 1] : "";
  return <OperationsShell active={screen}><main className="ops-main delivery-main" id="main-content" tabIndex={-1}>
    <header className="delivery-main-head"><div><p>{kitchen ? "Restaurant workspace / Kitchen" : "Restaurant workspace / Front of house"}</p><h1>{kitchen ? "Kitchen display" : "Delivery desk"}</h1></div>
      <div className="delivery-header-tools">{user ? <><span>{user.name}</span><button className="ops-text-button" onClick={async () => { try { await authRequest("logout"); setLogoutError(""); } catch { setLogoutError("Sign-out could not be confirmed. Try again."); } }}>Sign out</button></> : <span>Manager workspace</span>}</div>
    </header>
    {logoutError && <p role="alert">{logoutError}</p>}
    {!user ? <LoginPanel screen={screen} /> : <>
      {!kitchen && <nav className="delivery-mode" aria-label="Delivery views"><button aria-pressed={!history} onClick={() => { setHistory(false); setCursors([""]); }}>Active deliveries</button><button aria-pressed={history} onClick={() => setHistory(true)}>Order history</button></nav>}
      <Feed key={user.id + "/" + history + "/" + cursor} screen={screen} history={history} cursor={cursor} older={next => setCursors(list => [...list, next])} newer={() => setCursors(list => list.slice(0, -1))} />
    </>}
  </main></OperationsShell>;
}
