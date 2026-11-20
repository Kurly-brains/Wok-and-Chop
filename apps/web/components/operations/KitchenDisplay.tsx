"use client";

import { useEffect, useState } from "react";
import { DEMO_CLOCK } from "@wok/domain/training";
import { minutesWaiting, printLabels, restaurantTime, useDemoService, type DemoFulfillment } from "../../lib/demo-operations";
import { OperationsShell } from "./OperationsShell";
import { OrderContents } from "./OrderContents";
import { TicketAction, WorkspaceStatus } from "./TicketAction";

const columns: { status: DemoFulfillment; name: string; description: string }[] = [
  { status: "ACCEPTED", name: "Incoming", description: "Accept each ticket before starting" },
  { status: "IN_PREPARATION", name: "Preparing", description: "In the kitchen" },
  { status: "READY", name: "Ready", description: "At the pickup counter" },
];

export function KitchenDisplay() {
  const workspace = useDemoService();
  const { service } = workspace;
  const [now, setNow] = useState<number | null>(null);
  const [onlyAllergies, setOnlyAllergies] = useState(false);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 15_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  const active = service.orders.filter(order => ["ACCEPTED", "IN_PREPARATION", "READY"].includes(order.fulfillment))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const filtered = onlyAllergies ? active.filter(order => order.allergy) : active;
  const held = service.orders.filter(order => order.fulfillment === "SCHEDULED");

  return <OperationsShell active="kitchen"><main className="ops-main ops-kitchen-main" id="main-content" tabIndex={-1}>
    <div className="ops-title-row"><div><p className="ops-service-date">Kitchen · Main station</p><h1>Kitchen display</h1><p>{active.length} active pickup tickets · Earliest pickup first</p></div>
      <div className="ops-kitchen-clock"><strong>{now ? restaurantTime(new Date(now).toISOString()) : "—"}</strong><span>Toronto time</span></div>
    </div>
    <WorkspaceStatus workspace={workspace} />
    <div className="ops-kitchen-notice"><span>{service.paused ? "Training intake paused · " + service.pauseReason : "Training intake open"}</span>
      <label><input type="checkbox" checked={onlyAllergies} onChange={event => setOnlyAllergies(event.target.checked)} /> Allergy alerts only</label>
    </div>
    <div className="ops-kitchen-columns">{columns.map(column => {
      const tickets = filtered.filter(order => order.fulfillment === column.status);
      return <section key={column.status} className={`ops-kitchen-column kitchen-${column.status.toLowerCase()}`} aria-labelledby={`heading-${column.status}`}>
        <header><div><h2 id={`heading-${column.status}`}>{column.name}</h2><span>{column.description}</span></div><strong>{tickets.length}</strong></header>
        <div className="ops-kitchen-tickets">{tickets.length === 0 && <div className="ops-kitchen-empty"><p>{onlyAllergies ? "No allergy alerts here." : "No tickets here."}</p></div>}
          {tickets.map(order => {
            const historicalFixture = workspace.connection === "local" && order.events[0]?.id.startsWith(order.id + "-");
            const age = historicalFixture ? minutesWaiting(order, Date.parse(DEMO_CLOCK)) : now === null ? null : minutesWaiting(order, now);
            return <article key={order.id} className="ops-kitchen-ticket" aria-labelledby={`ticket-${order.id}`}>
              <div className="ops-kitchen-ticket-top"><h3 id={`ticket-${order.id}`}>#{order.id}</h3><div><span>Pickup</span><strong>{restaurantTime(order.dueAt)}</strong></div></div>
              <div className="ops-ticket-timing"><span>{age === null ? "—" : age + " min"} since intake</span><span>{order.fulfillment === "ACCEPTED" ? order.acknowledged ? "Accepted" : "Needs acceptance" : column.name}</span></div>
              <OrderContents order={order} />
              <div className="ops-kitchen-evidence"><span>{printLabels[order.jobs[0].status]}</span></div>
              <div className="ops-order-actions"><TicketAction order={order} workspace={workspace} /></div>
            </article>;
          })}
        </div>
      </section>;
    })}</div>
    {held.length > 0 && <section className="ops-scheduled-hold"><div><h2>Scheduled pickups</h2><p>Hold for release</p><span>Keep these tickets out of preparation.</span></div>
      {held.map(order => <div className="ops-hold-order" key={order.id}><strong>#{order.id}</strong><span>{order.items.reduce((total, item) => total + item.quantity, 0)} items</span><span>Pickup {restaurantTime(order.dueAt)}</span></div>)}
    </section>}
  </main></OperationsShell>;
}
