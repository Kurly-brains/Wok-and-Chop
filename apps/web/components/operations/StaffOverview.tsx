"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL } from "../../lib/customer-session";
import "../../styles/staff-overview.css";

type Days = 1 | 7 | 30;
type PickupStatus = "RECEIVED" | "PREPARING" | "READY_FOR_PICKUP" | "PICKED_UP" | "CANCELLED";
type PeriodMetric = "orders" | "completed" | "completedFoodTotalCents";
type Range = { startDate: string; endDate: string };
type Metrics = {
  orders: number;
  completed: number;
  cancelled: number;
  completedFoodTotalCents: number | null;
  averageCompletedValueCents: number | null;
};
type Overview = {
  asOf: string;
  range: Range;
  previousRange: Range;
  metrics: { current: Metrics; previous: Metrics };
  trend: {
    granularity: "hour" | "day";
    periods: ({ startAt: string; endAt: string } & Pick<Metrics, PeriodMetric>)[];
  };
  queue: { total: number; byStatus: Record<Exclude<PickupStatus, "PICKED_UP" | "CANCELLED">, number> };
  statusTotals: Record<PickupStatus, number>;
  topDishes: { itemId: string; name: string; quantity: number; completedOrders: number }[];
  recentPickups: { id: string; number: string; status: PickupStatus; createdAt: string; totalCents: number | null; itemCount: number; archived: boolean }[];
};
type RequestResult = { days: Days; revision: number } & ({ overview: Overview } | { error: string; signIn: boolean });

const dateOnly = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric" });
const localHour = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" });
const localHourWithZone = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const localDateTime = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const price = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const number = new Intl.NumberFormat("en-CA");
const shortPrice = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1 });

const ranges = [{ days: 1, label: "Today" }, { days: 7, label: "7 days" }, { days: 30, label: "30 days" }] as const;
const statusLabels: Record<PickupStatus, string> = { RECEIVED: "New", PREPARING: "Preparing", READY_FOR_PICKUP: "Ready for pickup", PICKED_UP: "Picked up", CANCELLED: "Cancelled" };
const statuses = Object.keys(statusLabels) as PickupStatus[];
const queueStatuses = ["RECEIVED", "PREPARING", "READY_FOR_PICKUP"] as const;
const chartMetrics = [{ key: "orders", label: "Orders" }, { key: "completed", label: "Picked up" }, { key: "completedFoodTotalCents", label: "Food value" }] as const;
const summaryMetrics = [
  { key: "orders", label: "Pickup orders", money: false },
  { key: "completed", label: "Picked up", money: false },
  { key: "completedFoodTotalCents", label: "Completed food value", money: true },
  { key: "averageCompletedValueCents", label: "Avg. completed pickup", money: true },
] as const;

function displayAmount(value: number | null, money = false) {
  if (value === null) return "Unavailable";
  return money ? price.format(value / 100) : number.format(value);
}

function displayRange(range: Range) {
  return dateOnly.formatRange(new Date(range.startDate), new Date(range.endDate));
}

function comparison(current: number | null, previous: number | null, money: boolean) {
  if (current === null || previous === null) return "No comparable value";
  const difference = current - previous;
  if (!difference) return "Unchanged";
  return `${displayAmount(Math.abs(difference), money)} ${difference > 0 ? "more" : "less"}`;
}

function Summary({ overview }: { overview: Overview }) {
  return <section className="staff-overview-summary" aria-label="Pickup summary">
    <dl>
      {summaryMetrics.map(({ key, label, money }) => {
        const current = overview.metrics.current[key];
        const emptyAverage = key === "averageCompletedValueCents" && overview.metrics.current.completed === 0;
        return <div key={key}>
          <dt>{label}</dt>
          <dd>{emptyAverage ? "—" : displayAmount(current, money)}</dd>
          <dd className="staff-overview-metric-detail">{emptyAverage ? "No completed pickups" : comparison(current, overview.metrics.previous[key], money)}</dd>
        </div>;
      })}
    </dl>
    <p>Compared with {displayRange(overview.previousRange)}. Today’s figures are through {localHour.format(new Date(overview.asOf))} Toronto time.</p>
  </section>;
}

function OrderTrend({ overview }: { overview: Overview }) {
  const [metric, setMetric] = useState<PeriodMetric>("orders");
  const [inspectedStart, setInspectedStart] = useState("");
  const periods = overview.trend.periods.filter(period => Date.parse(period.startAt) <= Date.parse(overview.asOf));
  const selected = periods.find(period => period.startAt === inspectedStart) ?? periods.at(-1);
  const hourly = overview.trend.granularity === "hour";
  const money = metric === "completedFoodTotalCents";
  const peak = Math.max(0, ...periods.map(period => period[metric] ?? 0));
  const step = money ? Math.max(100, Math.ceil(peak / 300) * 100) : Math.max(1, Math.ceil(peak / 3));
  const axisLabel = (at: string) => (hourly ? localHour : localDay).format(new Date(at));
  const pointLabel = (at: string) => (hourly ? localHourWithZone : localDay).format(new Date(at));
  const selectedMetricLabel = metric === "orders" ? selected?.orders === 1 ? "order" : "orders" : metric === "completed" ? "picked up" : "food value";
  const first = periods[0];
  const middle = periods.length > 2 ? periods[Math.floor(periods.length / 2)] : null;
  const last = periods.length > 1 ? periods.at(-1) : null;

  return <section className="staff-overview-trend" aria-labelledby="staff-overview-trend-title">
    <div className="staff-overview-section-head">
      <h2 id="staff-overview-trend-title">Order activity</h2>
      <div className="staff-overview-tabs staff-overview-tabs-small" role="group" aria-label="Trend metric">
        {chartMetrics.map(({ key, label }) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>{label}</button>)}
      </div>
    </div>
    <div className="staff-overview-chart" aria-hidden="true">
      <div className="staff-overview-chart-axis">{[3 * step, 2 * step, step, 0].map(tick => <span key={tick}>{money ? shortPrice.format(tick / 100) : number.format(tick)}</span>)}</div>
      <div className="staff-overview-chart-data">
        <div className="staff-overview-chart-bars">
          {periods.map(period => <div key={period.startAt} onPointerEnter={event => { if (event.pointerType === "mouse") setInspectedStart(period.startAt); }}>
            <span data-selected={selected?.startAt === period.startAt} data-unavailable={period[metric] === null} style={{ "--bar": `${(period[metric] ?? 0) / (3 * step) * 100}%` } as React.CSSProperties} />
          </div>)}
        </div>
        <div className="staff-overview-chart-dates">
          {first && <span>{axisLabel(first.startAt)}</span>}
          {middle && <span>{axisLabel(middle.startAt)}</span>}
          {last && <span>{axisLabel(last.startAt)}</span>}
        </div>
      </div>
    </div>
    {selected && <div className="staff-overview-inspect">
      <label htmlFor="staff-overview-trend-period">{hourly ? "Hour" : "Day"}</label>
      <select id="staff-overview-trend-period" value={selected.startAt} onChange={event => setInspectedStart(event.target.value)}>
        {periods.map(period => <option key={period.startAt} value={period.startAt}>{pointLabel(period.startAt)}</option>)}
      </select>
      <output htmlFor="staff-overview-trend-period" aria-live="polite">{displayAmount(selected[metric], money)} <span>{selectedMetricLabel}</span></output>
    </div>}
  </section>;
}

function ActiveQueue({ queue }: { queue: Overview["queue"] }) {
  return <section className="staff-overview-queue" aria-labelledby="staff-overview-queue-title">
    <h2 id="staff-overview-queue-title">In progress</h2>
    <div className="staff-overview-queue-total"><strong>{number.format(queue.total)}</strong> {queue.total === 1 ? "active pickup" : "active pickups"}</div>
    <dl>
      {queueStatuses.map(status => <div key={status}><dt><i data-status={status} aria-hidden="true" />{statusLabels[status]}</dt><dd>{number.format(queue.byStatus[status])}</dd></div>)}
    </dl>
    <Link className="staff-overview-text-link" href="/kitchen/">Kitchen display <span aria-hidden="true">↗</span></Link>
  </section>;
}

function RecentPickups({ overview }: { overview: Overview }) {
  const [filter, setFilter] = useState<"all" | PickupStatus>("all");
  const pickups = overview.recentPickups.filter(order => filter === "all" || order.status === filter);

  return <section className="staff-overview-recent" aria-labelledby="staff-overview-recent-title">
    <div className="staff-overview-section-head">
      <h2 id="staff-overview-recent-title">Recent pickups</h2>
      <div className="staff-overview-filter">
        <label htmlFor="staff-overview-status">Status</label>
        <select id="staff-overview-status" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
          <option value="all">All statuses</option>
          {statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
        </select>
      </div>
    </div>
    {pickups.length ? <table className="staff-overview-orders" aria-label="Most recent pickup orders">
      <thead><tr><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Order total</th></tr></thead>
      <tbody>{pickups.map(order => <tr key={order.id}>
        <th scope="row"><strong>{order.number}</strong><small>{localDateTime.format(new Date(order.createdAt))}</small></th>
        <td><span className="staff-overview-order-status"><i data-status={order.status} aria-hidden="true" />{statusLabels[order.status]}</span>{order.archived && <small>Archived</small>}</td>
        <td><strong>{displayAmount(order.totalCents, true)}</strong><small>{order.itemCount} {order.itemCount === 1 ? "item" : "items"}</small></td>
      </tr>)}</tbody>
    </table> : <p className="staff-overview-empty">{filter === "all" ? "No pickups in this period." : <>No recent pickups match this status. <strong>{number.format(overview.statusTotals[filter])}</strong> in the selected period.</>}</p>}
    <Link className="staff-overview-text-link" href="/staff/">Open order desk <span aria-hidden="true">↗</span></Link>
  </section>;
}

function MostOrdered({ dishes }: { dishes: Overview["topDishes"] }) {
  const maximum = Math.max(1, ...dishes.map(dish => dish.quantity));
  return <section className="staff-overview-dishes" aria-labelledby="staff-overview-dishes-title">
    <h2 id="staff-overview-dishes-title">Most ordered dishes</h2>
    {dishes.length ? <>
      <p>By quantity in completed pickups</p>
      <ol>{dishes.map(dish => <li key={dish.itemId}>
        <div><span>{dish.name}</span><strong>{number.format(dish.quantity)}</strong></div>
        <span className="staff-overview-dish-rule" aria-hidden="true"><span style={{ width: `${dish.quantity / maximum * 100}%` }} /></span>
      </li>)}</ol>
    </> : <p className="staff-overview-empty">Dishes appear here after a pickup is completed.</p>}
    <Link className="staff-overview-text-link" href="/staff/menu/">Menu editor <span aria-hidden="true">↗</span></Link>
  </section>;
}

export function StaffOverview() {
  const [days, setDays] = useState<Days>(7);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<RequestResult | null>(null);
  const periodResult = result?.days === days ? result : null;
  const current = periodResult?.revision === revision ? periodResult : null;
  const overview = periodResult && "overview" in periodResult ? periodResult.overview : null;
  const error = current && "error" in current ? current : null;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${API_URL}/v1/auth/admin/overview?days=${days}`, {
          credentials: "include", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setResult({ days, revision, signIn: true, error: "Sign in as a restaurant manager to view the overview." });
          return;
        }
        if (!response.ok) throw new Error("Overview unavailable");
        const data = await response.json() as Overview;
        if (!controller.signal.aborted) setResult({ days, revision, overview: data });
      } catch {
        if (!controller.signal.aborted) setResult({ days, revision, signIn: false, error: "Couldn’t load pickup activity. Try refreshing the overview." });
      }
    }
    void load();
    return () => controller.abort();
  }, [days, revision]);

  return <main className="staff-overview" id="main-content" tabIndex={-1}>
    <header className="staff-overview-header">
      <div><h1>Restaurant overview</h1><p>Direct pickup activity</p></div>
      <Link className="staff-overview-action" href="/staff/">Order desk <span aria-hidden="true">↗</span></Link>
    </header>
    <div className="staff-overview-toolbar">
      <div className="staff-overview-tabs" role="group" aria-label="Date range">
        {ranges.map(range => <button key={range.days} type="button" aria-pressed={days === range.days} onClick={() => setDays(range.days)}>{range.label}</button>)}
      </div>
      <div className="staff-overview-toolbar-end">
        {overview && <span>{displayRange(overview.range)}</span>}
        <button className="staff-overview-refresh" type="button" onClick={() => setRevision(value => value + 1)} disabled={!current}><span aria-hidden="true">↻</span> Refresh</button>
      </div>
    </div>
    {!current && <p className={overview ? "staff-overview-loading" : "staff-overview-feedback"} role="status">{overview ? "Refreshing pickup activity…" : "Loading pickup activity…"}</p>}
    {error && <div className="staff-overview-feedback" role="alert"><p>{error.error}</p>{error.signIn && <Link href="/staff/sign-in/?next=overview">Staff sign-in</Link>}</div>}
    {overview && <>
      <Summary overview={overview} />
      <div className="staff-overview-column-row"><OrderTrend overview={overview} /><ActiveQueue queue={overview.queue} /></div>
      <div className="staff-overview-column-row"><RecentPickups overview={overview} /><MostOrdered dishes={overview.topDishes} /></div>
    </>}
  </main>;
}
