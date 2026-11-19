"use client";

import { useEffect, useState } from "react";
import { API_URL, authRequest, useCustomer } from "../../lib/customer-session";
import { ManagerSignIn } from "./ManagerSignIn";
import { OperationsShell } from "./OperationsShell";

type Report = {
  startDate: string;
  endDate: string;
  requests: number;
  delivered: number;
  cancelled: number;
  foodTotalCents: number;
  prepMinutes: number | null;
  deliveryMinutes: number | null;
  dishes: { name: string; quantity: number }[];
  hours: { hour: number; requests: number }[];
  promos: { code: string; redemptions: number; discountCents: number }[];
};

const currency = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const date = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" });
const hour = new Intl.DateTimeFormat("en-CA", { hour: "numeric", hour12: true, timeZone: "UTC" });
const minutes = (value: number | null) => value === null ? "—" : `${value} min`;

function ReportContent({ report }: { report: Report }) {
  const metrics = [
    ["Requests received", report.requests],
    ["Delivered", report.delivered],
    ["Cancelled", report.cancelled],
    ["Delivered food value", currency.format(report.foodTotalCents / 100)],
    ["Average kitchen time", minutes(report.prepMinutes)],
    ["Average delivery time", minutes(report.deliveryMinutes)],
  ];
  return <>
    <p className="reports-period">{date.formatRange(new Date(report.startDate), new Date(report.endDate))} · Toronto time</p>
    <dl className="reports-metrics">
      {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <div className="reports-tables">
      <section aria-labelledby="report-dishes">
        <h2 id="report-dishes">Most ordered dishes</h2>
        {report.dishes.length ? <ul>
          {report.dishes.map(dish => <li key={dish.name}><span>{dish.name}</span><strong>{dish.quantity}</strong></li>)}
        </ul> : <p>Dish totals appear once a request is delivered.</p>}
      </section>
      <section aria-labelledby="report-hours">
        <h2 id="report-hours">Busiest hours</h2>
        {report.hours.length ? <ul>
          {report.hours.map(row => <li key={row.hour}>
            <span>{hour.format(new Date(Date.UTC(2000, 0, 1, row.hour)))}</span>
            <strong>{row.requests} {row.requests === 1 ? "request" : "requests"}</strong>
          </li>)}
        </ul> : <p>There were no requests in this period.</p>}
      </section>
      <section aria-labelledby="report-promos">
        <h2 id="report-promos">Promotion use</h2>
        {report.promos.length ? <ul>
          {report.promos.map(promo => <li key={promo.code}>
            <span>{promo.code} · {promo.redemptions} {promo.redemptions === 1 ? "use" : "uses"}</span>
            <strong>{currency.format(promo.discountCents / 100)}</strong>
          </li>)}
        </ul> : <p>There were no delivered requests with a discount.</p>}
      </section>
    </div>
  </>;
}

function ReportWorkspace() {
  const [days, setDays] = useState(7);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setReport(null);
      setError("");
      try {
        const response = await fetch(`${API_URL}/v1/auth/admin/delivery-reports?days=${days}`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        if (response.status === 403) throw new Error("Reports require a restaurant manager account.");
        if (response.status === 401) throw new Error("Your session has expired. Sign in again.");
        if (!response.ok) throw new Error("Delivery reports are temporarily unavailable.");
        const data = await response.json() as Report;
        if (!controller.signal.aborted) setReport(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "Delivery reports are temporarily unavailable.");
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [days, revision]);

  return <>
    <div className="reports-toolbar">
      <label htmlFor="report-days">Reporting period</label>
      <select id="report-days" value={days} onChange={event => setDays(Number(event.target.value))}>
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
      </select>
      <button className="ops-text-button" onClick={() => setRevision(value => value + 1)}>Refresh</button>
    </div>
    {error ? <p role="alert">{error}</p>
      : report ? <ReportContent report={report} /> : <p role="status">Loading delivery reports…</p>}
  </>;
}

export default function DeliveryReports() {
  const user = useCustomer();
  const [error, setError] = useState("");
  return <OperationsShell active="reports">
    <main id="main-content" tabIndex={-1} className="ops-main reports-main">
      <div className="ops-title-row">
        <h1>Delivery reports</h1>
        {user && <button className="ops-text-button" onClick={async () => {
          setError("");
          try { await authRequest("logout"); }
          catch { setError("Sign-out could not be confirmed. Try again."); }
        }}>Sign out</button>}
      </div>
      <p className="reports-intro">Order activity and food values from the local unpaid delivery preview.</p>
      {error && <p role="alert">{error}</p>}
      {user ? <ReportWorkspace key={user.id} /> :
        <ManagerSignIn description="Sign in with your restaurant manager account to view delivery reports." />}
    </main>
  </OperationsShell>;
}
