"use client";

import { useRef, useState, type FormEvent } from "react";
import { demoMoney, fulfillmentLabels, paymentLabels, printLabels, restaurantTime, useDemoService, type DemoOrder, type TrainingWorkspace } from "../../lib/demo-operations";
import { OperationsShell } from "./OperationsShell";
import { OrderContents } from "./OrderContents";
import { PrinterStation } from "./PrinterStation";
import { TicketAction, WorkspaceStatus } from "./TicketAction";
import { TrainingSlip } from "./TrainingSlip";
import { TrainingIntake } from "./TrainingIntake";

const filters = ["Active", "Incoming", "Preparing", "Ready", "Scheduled", "Attention", "History"] as const;
type Filter = typeof filters[number];
const torontoDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });

function matches(order: DemoOrder, filter: Filter) {
  switch (filter) {
    case "Incoming": return order.fulfillment === "ACCEPTED" && !order.acknowledged;
    case "Preparing": return order.fulfillment === "IN_PREPARATION";
    case "Ready": return order.fulfillment === "READY";
    case "Scheduled": return order.fulfillment === "SCHEDULED";
    case "Attention": return order.jobs[0]?.status === "UNKNOWN" && !order.acknowledged;
    case "History": return true;
    case "Active": return ["ACCEPTED", "IN_PREPARATION", "READY"].includes(order.fulfillment);
  }
}

function stage(order: DemoOrder) {
  return order.fulfillment === "ACCEPTED" && !order.acknowledged ? "Incoming" : fulfillmentLabels[order.fulfillment];
}

function OrderDetail({ order, workspace }: { order: DemoOrder; workspace: TrainingWorkspace }) {
  const [reason, setReason] = useState("");
  const [reprintOpen, setReprintOpen] = useState(false);
  const canRequestCopy = !["SCHEDULED", "COMPLETED"].includes(order.fulfillment) && !order.jobs.some(job => job.kind === "REPRINT" && job.status === "QUEUED");
  async function reprint(event: FormEvent) {
    event.preventDefault();
    if (await workspace.run({ type: "reprint", orderId: order.id, reason, priorCopies: order.jobs.filter(job => job.kind === "REPRINT").length }, "Training copy request recorded.")) setReprintOpen(false);
  }
  return <>
    <div className="ops-detail-heading"><div><span>Pickup ticket</span><h2 id="detail-heading">#{order.id}</h2></div><div><span>Promised for</span><strong>{restaurantTime(order.dueAt)}</strong></div></div>
    <div className="ops-detail-meta"><span>{order.guest}</span><span>{stage(order)}</span></div>
    {order.fulfillment === "SCHEDULED" && <div className="ops-hold"><strong>HOLD — DO NOT PREPARE</strong><p>Scheduled training pickup. Release is held.</p></div>}
    <OrderContents order={order} />
    <dl className="ops-evidence">
      <div><dt>Payment</dt><dd>{paymentLabels[order.payment]}</dd></div>
      <div><dt>Training amount</dt><dd>{demoMoney(order.amountCents)} CAD</dd></div>
      <div><dt>Original ticket</dt><dd>{printLabels[order.jobs[0].status]}</dd></div>
      <div><dt>Kitchen acknowledgment</dt><dd>{order.acknowledged ? "Accepted" : "Awaiting acceptance"}</dd></div>
    </dl>
    <div className="ops-order-actions"><TicketAction order={order} workspace={workspace} />
      {canRequestCopy && <button type="button" className="ops-text-button" aria-expanded={reprintOpen} onClick={() => setReprintOpen(!reprintOpen)}>Request a training copy</button>}
    </div>
    {canRequestCopy && reprintOpen && <form className="ops-reprint-form" onSubmit={reprint}>
      <label htmlFor="reprint-reason">What did you check? Why is a copy needed?</label>
      <textarea id="reprint-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={240} required />
      <button type="submit" className="ops-button" disabled={workspace.busy}>Record copy request</button>
    </form>}
    {order.jobs.filter(job => job.kind === "REPRINT").map(job => <div key={job.id} className="ops-reprint-record"><strong>Reprint · Copy {job.copy}</strong><span>{printLabels[job.status]}</span><p>{job.reason}</p></div>)}
    {order.jobs.filter(job => job.status === "SPOOLED").map(job => <TrainingSlip key={job.id} job={job} orderNumber={order.id} />)}
    <details className="ops-activity"><summary>Order activity <span>{order.events.length}</span></summary><ol>{[...order.events].reverse().map(event => <li key={event.id}><time dateTime={event.at}>{restaurantTime(event.at)}</time><span>{event.text}</span></li>)}</ol></details>
  </>;
}

export function StaffConsole() {
  const workspace = useDemoService();
  const { service } = workspace;
  const [filter, setFilter] = useState<Filter>("Active");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const detail = useRef<HTMLElement>(null);
  const term = search.toLowerCase().trim().replace(/^#/, "");
  const visible = service.orders.filter(order => matches(order, filter)
    && (!date || torontoDate.format(new Date(order.acceptedAt)) === date)
    && [order.id, order.guest, ...order.items.map(item => item.name)].some(text => text.toLowerCase().includes(term)));
  const selected = visible.find(order => order.id === selectedId) ?? visible[0];
  const count = (value: Filter) => service.orders.filter(order => matches(order, value)).length;

  async function pause(event: FormEvent) {
    event.preventDefault();
    if (await workspace.run({ type: "pause", reason: pauseReason }, "Training intake paused.")) { setPauseOpen(false); setPauseReason(""); }
  }
  function select(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 760px)").matches) detail.current?.focus();
  }
  return <OperationsShell active="staff"><main className="ops-main" id="main-content" tabIndex={-1}>
    <div className="ops-title-row"><div><p className="ops-service-date">Front of house · Kanata</p><h1>Order board</h1><p>Pickup tickets, kitchen progress and handoff.</p></div>
      <div className="ops-service-controls"><span className="ops-service-indicator"><span aria-hidden="true" />Training intake {service.paused ? "paused" : "open"}</span>
        <button type="button" className="ops-button" disabled={workspace.busy || service.paused} aria-expanded={intakeOpen} onClick={() => setIntakeOpen(!intakeOpen)}>{intakeOpen ? "Close entry" : "Enter training order"}</button>
        <button type="button" className="ops-text-button" disabled={workspace.busy} onClick={() => service.paused ? void workspace.run({ type: "resume" }, "Training intake resumed.") : setPauseOpen(!pauseOpen)}>{service.paused ? "Resume intake" : "Pause intake"}</button>
      </div>
    </div>
    <WorkspaceStatus workspace={workspace} />
    {pauseOpen && <form className="ops-pause-form" onSubmit={pause}><label htmlFor="pause-reason">Reason for pause</label><input id="pause-reason" value={pauseReason} onChange={event => setPauseReason(event.target.value)} minLength={5} maxLength={160} required /><button type="submit" className="ops-button" disabled={workspace.busy}>Pause training intake</button><button type="button" className="ops-text-button" onClick={() => setPauseOpen(false)}>Cancel</button></form>}
    {service.paused && <p className="ops-paused-note"><strong>Intake paused.</strong> {service.pauseReason}</p>}
    {intakeOpen && <TrainingIntake workspace={workspace} onCreated={() => { setIntakeOpen(false); setFilter("Incoming"); setSelectedId(""); setDate(""); setSearch(""); }} />}
    <div className="ops-status-strip" aria-label="Queue counts">{(["Incoming", "Preparing", "Ready", "Scheduled"] as const).map(value => <div key={value}><span>{value}</span><strong>{count(value)}</strong></div>)}</div>
    {count("Attention") > 0 && <div className="ops-attention"><span><strong>Ticket check required.</strong> A simulated printer acknowledgment is missing.</span><button type="button" onClick={() => { setFilter("Attention"); setSearch(""); setDate(""); }}>Review ticket →</button></div>}
    <div className="ops-board-layout">
      <section className="ops-queue" aria-labelledby="queue-heading">
        <div className="ops-section-heading"><h2 id="queue-heading">{filter === "History" ? "Order history" : "Pickup queue"}</h2><span>{visible.length} tickets · Toronto time</span></div>
        <div className="ops-queue-toolbar"><div className="ops-filters" role="group" aria-label="Filter tickets">{filters.map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}<span>{count(value)}</span></button>)}</div>
          <div className="ops-query"><label className="ops-search"><span className="ops-sr-only">Search by ticket, guest or dish</span><input type="search" placeholder="Ticket number, guest or dish" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className="ops-date">Intake date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div>
        </div>
        <div className="ops-order-list">{visible.length === 0 ? <div className="ops-empty"><h3>No matching tickets.</h3><p>Try another date, filter or search term.</p></div> : visible.map(order => <button key={order.id} type="button" className={`ops-order-row ${selected?.id === order.id ? "is-selected" : ""}`} aria-pressed={selected?.id === order.id} onClick={() => select(order.id)}>
          <span className="ops-order-number">#{order.id}<small>{order.items.reduce((total, item) => total + item.quantity, 0)} items</small></span>
          <span className="ops-order-overview"><strong>{order.guest}</strong><span>{order.items.map(item => item.quantity + " × " + item.name).join(", ")}</span>{order.allergy && <span className="ops-warning-text">Allergy alert</span>}</span>
          <span className="ops-order-due"><strong>{restaurantTime(order.dueAt)}</strong><span className={`ops-state state-${order.fulfillment.toLowerCase()}`}>{stage(order)}</span></span>
        </button>)}</div>
      </section>
      <aside ref={detail} tabIndex={-1} className="ops-order-detail" aria-label="Selected ticket">{selected ? <OrderDetail key={selected.id} order={selected} workspace={workspace} /> : <p>Select a matching ticket to view its details.</p>}</aside>
    </div>
    <PrinterStation />
  </main></OperationsShell>;
}
