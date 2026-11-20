"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { formatMoney } from "@wok/domain";
import { authRequest, useCustomer } from "../../lib/customer-session";
import {
  nextOrderAction, restaurantClock, restaurantDate, statusNames, useManagerDeliveries,
  type ManagerAuditEvent, type ManagerOrderStatus, type ManagerDelivery, type ManagerQueue, type ManagerQueueScope,
} from "../../lib/manager-deliveries";
import { DeliverySlipTools } from "./DeliverySlipTools";
import { OperationsShell } from "./OperationsShell";
import { PickupManagement } from "./PickupManagement";
import { StaffPickupCreate } from "./StaffPickupCreate";
import "../../styles/delivery-operations.css";

type Screen = "staff" | "kitchen";
const pickupStages = ["RECEIVED", "PREPARING", "READY_FOR_PICKUP"] as const;
const activeStages = [...pickupStages, "OUT_FOR_DELIVERY"] as const;
const kitchenNames = { RECEIVED: "Incoming", PREPARING: "Preparing", READY_FOR_PICKUP: "Ready for pickup", OUT_FOR_DELIVERY: "With driver" };
const kitchenTiming = { RECEIVED: "Waiting", PREPARING: "In preparation", READY_FOR_PICKUP: "Ready", OUT_FOR_DELIVERY: "With driver" };
const kitchenEmpty = { RECEIVED: "No tickets waiting.", PREPARING: "No tickets in preparation.", READY_FOR_PICKUP: "No orders waiting to be picked up.", OUT_FOR_DELIVERY: "No tickets with a driver." };
const orderViews: Record<ManagerQueueScope, string> = {
  active: "Active orders", history: "Order history", archived: "Archived orders",
};
const signInPath = {
  staff: "/staff/sign-in/?next=%2Fstaff%2F",
  kitchen: "/staff/sign-in/?next=%2Fkitchen%2F",
};
function stagesFor(orders: readonly ManagerDelivery[]) {
  return orders.some(order => order.fulfillment !== "PICKUP") ? activeStages : pickupStages;
}
function stamp(iso: string) {
  const date = new Date(iso);
  return restaurantDate.format(date) + " · " + restaurantClock.format(date);
}

function elapsed(start: string, checked: Date) {
  const minutes = Math.max(0, Math.floor((checked.getTime() - Date.parse(start)) / 60000));
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours} h ${minutes % 60} min`;
  return minutes ? `${minutes} min` : "<1 min";
}

function Stage({ status }: { status: ManagerOrderStatus }) {
  return <span className={"delivery-stage stage-" + status.toLowerCase()}>{statusNames[status]}</span>;
}

function LoginPanel({ screen }: { screen: Screen }) {
  return <div className="ops-lockup">
    <div className="ops-lockup-form">
      <h2>Staff sign-in</h2>
      <p>{screen === "staff" ? "Manage orders and record pickup handoffs with a staff account." : "Sign in to see incoming orders, read prep notes and mark food ready."}</p>
      <Link className="ops-button ops-lockup-action" href={signInPath[screen]}>
        Sign in to the restaurant workspace <span aria-hidden="true">→</span>
      </Link>
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
  const action = nextOrderAction(order);
  const waitingForHandoff = order.status === "OUT_FOR_DELIVERY" || order.status === "READY_FOR_PICKUP";
  const canCancel = !kitchen && (order.status === "RECEIVED" || order.status === "PREPARING" || order.status === "READY_FOR_PICKUP");
  if (!action || (kitchen && waitingForHandoff)) return null;
  if (cancel && canCancel) return <div className="delivery-confirm" role="group" aria-label="Confirm cancellation">
    <strong>Cancel {order.number}?</strong><p>Cancellation removes this ticket from the active order queue.</p>
    <button className="ops-button" disabled={queue.saving} onClick={() => void queue.transition(order, "CANCELLED")}>Confirm cancellation</button>
    <button className="ops-text-button" disabled={queue.saving} onClick={() => setCancel(false)}>Keep order</button>
  </div>;
  return <div className="delivery-actions">
    <button className="ops-button" disabled={queue.saving} onClick={() => void queue.transition(order, action.status)}>{action.title} <span aria-hidden="true">→</span></button>
    {canCancel && <button className="ops-text-button" disabled={queue.saving} onClick={() => setCancel(true)}>{order.fulfillment === "PICKUP" ? "Cancel order" : "Cancel request"}</button>}
  </div>;
}

function auditLabel(event: ManagerAuditEvent) {
  switch (event.action) {
    case "UNDO": return `Status corrected to ${statusNames[event.status].toLowerCase()}`;
    case "NOTE": return "Manager note updated";
    case "ARCHIVE": return "Archived";
    case "RESTORE": return "Restored to order history";
    default: return statusNames[event.status];
  }
}

function Timeline({ order }: { order: ManagerDelivery }) {
  const events = order.auditHistory?.length
    ? order.auditHistory.map(event => ({ key: event.version, title: auditLabel(event), at: event.at, reason: event.reason }))
    : (order.statusHistory ?? []).map((event, index) => ({ key: event.at + "/" + index, title: statusNames[event.status], at: event.at, reason: null }));
  if (!events.length) return null;
  return <details className="delivery-status-history">
    <summary>Service timeline</summary>
    <ol>{events.map(event => <li key={event.key}>
      <div><span>{event.title}</span>{event.reason && <p>{event.reason}</p>}</div><time dateTime={event.at}>{stamp(event.at)}</time>
    </li>)}</ol>
  </details>;
}

function Details({ order, queue }: { order: ManagerDelivery; queue: ManagerQueue }) {
  const { address } = order;
  const pickup = order.fulfillment === "PICKUP";
  return <>
    <div className="delivery-detail-head"><div><span>{pickup ? order.createdByManager ? "Staff-entered pickup" : "Pickup ticket" : "Delivery ticket"}</span><h2>{order.number}</h2></div><Stage status={order.status} /></div>
    <dl className="delivery-detail-meta"><div><dt>Received</dt><dd>{stamp(order.createdAt)}</dd></div><div><dt>Last update</dt><dd>{stamp(order.updatedAt)}</dd></div>
      {order.archivedAt && <div><dt>Archived</dt><dd>{stamp(order.archivedAt)}</dd></div>}
    </dl>
    <section className="delivery-recipient"><h3>{pickup ? "Pickup customer" : "Deliver to"}</h3><div><strong>{order.name}</strong><a href={"tel:" + order.phone.replace(/[^\d+]/g, "")}>{order.phone}</a></div>
      {address && <address>{address.street}{address.unit ? ", " + address.unit : ""}<br />{address.city}, {address.province} {address.postalCode}</address>}
      {order.instructions && <p><b>{pickup ? "Order notes" : "Delivery instructions"}</b> {order.instructions}</p>}
    </section>
    <Items order={order} prices />
    <dl className="delivery-totals"><div><dt>Subtotal</dt><dd>{formatMoney(order.subtotalCents)}</dd></div>
      {order.discountCents > 0 && <div><dt>Discount</dt><dd>−{formatMoney(order.discountCents)}</dd></div>}
      {!pickup && <div><dt>Delivery fee</dt><dd>{order.deliveryCents === null ? "To be confirmed" : formatMoney(order.deliveryCents)}</dd></div>}
      <div><dt>Tax</dt><dd>{order.taxCents === null ? "To be confirmed" : formatMoney(order.taxCents)}</dd></div>
      <div className="delivery-total"><dt>Food total <small>CAD</small></dt><dd>{formatMoney(order.totalCents)}</dd></div>
    </dl>
    {pickup && nextOrderAction(order) && <p className="delivery-pickup-payment">Payment due at pickup.</p>}
    <Actions key={order.version} order={order} queue={queue} />
    {pickup && <PickupManagement order={order} queue={queue} />}
    <Timeline order={order} />
    <DeliverySlipTools key={order.id} order={order} />
  </>;
}

function StaffTickets({ queue, view }: { queue: ManagerQueue; view: ManagerQueueScope }) {
  const [filter, setFilter] = useState<ManagerOrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [id, setId] = useState("");
  const detail = useRef<HTMLElement>(null);
  const history = view !== "active";
  const archived = view === "archived";
  const statuses = archived ? (["PICKED_UP", "CANCELLED"] as const)
    : history ? (["PICKED_UP", "DELIVERED", "CANCELLED"] as const) : stagesFor(queue.orders);
  const currentFilter = statuses.some(status => status === filter) ? filter : "all";
  const term = search.trim().toLowerCase().replace(/^#/, "");
  const results = queue.orders.filter(o => (currentFilter === "all" || o.status === currentFilter)
    && [o.number, o.name, o.phone, o.address?.street, o.address?.postalCode].some(field => field?.toLowerCase().includes(term)));
  const selected = results.find(order => order.id === id) ?? results[0];
  return <div className="deliveries-desk">
    <section className="deliveries-list" aria-label={orderViews[view]}>
      <div className="delivery-desk-heading">
        <h2>{archived ? "Archived pickups" : history ? "Past orders" : "Current orders"}</h2>
        <span>{queue.orders.length} {queue.orders.length === 1 ? "order" : "orders"}{history ? " on this page" : ""}</span>
      </div>
      <div className="delivery-stage-filters" role="group" aria-label="Filter by order status">
        <button type="button" aria-pressed={currentFilter === "all"} onClick={() => setFilter("all")}>All <b>{queue.orders.length}</b></button>
        {statuses.map(s => <button key={s} type="button" aria-pressed={currentFilter === s} onClick={() => setFilter(s)}>{statusNames[s]} <b>{queue.orders.filter(order => order.status === s).length}</b></button>)}
      </div>
      <label className="delivery-search"><span className="ops-sr-only">Search tickets on this page</span><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={history ? "Search this page of order history" : "Find a ticket, name or address"} /></label>
      {results.length === 0 ? <div className="delivery-empty"><h3>{queue.orders.length ? "No matching orders" : archived ? "No archived pickups" : history ? "No order history yet" : "No active orders"}</h3>
        <p>{queue.orders.length ? "Choose another status or search term." : archived ? "Archived pickups can be restored to order history here." : history ? "Completed and cancelled orders appear here." : "New orders appear here automatically."}</p></div>
      : <ul className="delivery-list-rows">{results.map(order => <li key={order.id}><button aria-pressed={selected?.id === order.id} onClick={() => {
        setId(order.id);
        if (window.matchMedia("(max-width: 760px)").matches) detail.current?.focus();
      }}>
        <span className="delivery-row-ref"><strong>{order.number}</strong><small>{stamp(order.createdAt)}</small></span>
        <span className="delivery-row-name"><b>{order.name}</b><small>{order.fulfillment === "PICKUP" ? "Pickup" : "Delivery"}</small>
          {history && order.managerNote && <small className="delivery-row-note">{order.managerNote}</small>}
        </span>
        <Stage status={order.status} />
      </button></li>)}</ul>}
    </section>
    <aside className="delivery-detail" ref={detail} tabIndex={-1} aria-label="Order details">{selected ? <Details key={selected.id} order={selected} queue={queue} /> :
      <div className="delivery-detail-placeholder"><span>Order ticket</span><p>Select an order to see its dishes and handoff details.</p></div>}</aside>
  </div>;
}

function KitchenTickets({ queue }: { queue: ManagerQueue }) {
  const sorted = [...queue.orders].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const stages = stagesFor(queue.orders);
  return <div className="delivery-kds" data-columns={stages.length}>{stages.map(status => {
    const orders = sorted.filter(order => order.status === status);
    return <section key={status} className={"delivery-station station-" + status.toLowerCase()} aria-label={kitchenNames[status]}>
      <header><h2>{kitchenNames[status]}</h2><span>{orders.length}</span></header>
      {!orders.length && <p className="delivery-station-empty">{kitchenEmpty[status]}</p>}
      {orders.map(order => <article key={order.id} className="delivery-kitchen-ticket" aria-label={(order.fulfillment === "PICKUP" ? "Pickup " : "Delivery ") + order.number}>
        <div className="delivery-detail-head"><div><span>{order.fulfillment === "PICKUP" ? "Pickup ticket" : "Delivery ticket"}</span><h3>{order.number}</h3></div><time dateTime={order.createdAt}>{stamp(order.createdAt)}</time></div>
        {queue.checked && <p className="delivery-kitchen-elapsed">
          {kitchenTiming[status]} <strong>{elapsed(order.updatedAt, queue.checked)}</strong>
        </p>}
        <Items order={order} />
        <Actions key={order.version} kitchen order={order} queue={queue} />
      </article>)}
    </section>;
  })}</div>;
}

function Feed({ screen, managerId, view, cursor, older, newer }: { screen: Screen; managerId: string; view: ManagerQueueScope; cursor: string; older(cursor: string): void; newer(): void }) {
  const queue = useManagerDeliveries(view, cursor);
  if (queue.access === "signed-out") return <LoginPanel screen={screen} />;
  if (queue.access === "forbidden") return <div className="delivery-feedback"><h2>Manager access required</h2><p>Sign out and use an account authorized by the restaurant.</p></div>;
  if (queue.access === "error") return <div className="delivery-feedback" role="alert"><h2>Order queue unavailable</h2><p>Reconnect to load the current tickets.</p><button className="ops-button" onClick={() => void queue.refresh()}>Try again</button></div>;
  if (queue.access === "loading") return <p className="delivery-feedback" role="status">Loading order tickets…</p>;
  return <>
    <div className="delivery-sync">
      <span>{queue.checked && "Updated " + restaurantClock.format(queue.checked) + " · Toronto time"}</span>
      <button type="button" className="ops-text-button" disabled={queue.saving} onClick={() => void queue.refresh()}>Refresh</button>
      {screen === "staff" && view === "active" && <StaffPickupCreate managerId={managerId} onCreated={() => void queue.refresh()} />}
    </div>
    <p className="delivery-message" role="status">{queue.message}</p>
    {screen === "kitchen" ? <KitchenTickets queue={queue} /> : <StaffTickets view={view} queue={queue} />}
    {view !== "active" && <nav className="delivery-pages" aria-label={view === "archived" ? "Archive pages" : "History pages"}>
      <button className="ops-text-button" disabled={!cursor} onClick={newer}>← Newer orders</button>
      <button className="ops-text-button" disabled={!queue.nextCursor} onClick={() => queue.nextCursor && older(queue.nextCursor)}>Older orders →</button>
    </nav>}
  </>;
}

export function DeliveryWorkspace({ screen }: { screen: Screen }) {
  const user = useCustomer();
  const [view, setView] = useState<ManagerQueueScope>("active");
  const [cursors, setCursors] = useState([""]);
  const [logoutError, setLogoutError] = useState("");
  const kitchen = screen === "kitchen";
  const cursor = view === "active" ? "" : cursors[cursors.length - 1];
  return <OperationsShell active={screen}><main className="ops-main delivery-main" id="main-content" tabIndex={-1}>
    <header className="delivery-main-head"><div><p>{kitchen ? "Kitchen" : "Front of house"}</p><h1>{kitchen ? "Kitchen display" : "Order desk"}</h1></div>
      {user && <div className="delivery-header-tools"><span>{user.name}</span><button className="ops-text-button" onClick={async () => { try { await authRequest("logout"); setLogoutError(""); } catch { setLogoutError("Sign-out could not be confirmed. Try again."); } }}>Sign out</button></div>}
    </header>
    {logoutError && <p role="alert">{logoutError}</p>}
    {!user ? <LoginPanel screen={screen} /> : <>
      {!kitchen && <nav className="delivery-mode" aria-label="Order views">{(Object.keys(orderViews) as ManagerQueueScope[]).map(scope => (
        <button type="button" key={scope} aria-pressed={view === scope} onClick={() => { if (view !== scope) { setView(scope); setCursors([""]); } }}>{orderViews[scope]}</button>
      ))}</nav>}
      <Feed key={user.id + "/" + view + "/" + cursor} screen={screen} managerId={user.id} view={view} cursor={cursor} older={next => setCursors(list => [...list, next])} newer={() => setCursors(list => list.slice(0, -1))} />
    </>}
  </main></OperationsShell>;
}
