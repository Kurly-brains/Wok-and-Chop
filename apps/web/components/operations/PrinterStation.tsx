"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PrinterStatus, TestResult } from "../../../print-bridge/diagnostics.cjs";
import { API_URL } from "../../lib/customer-session";
import "../../styles/printer-station.css";

const endpoint = API_URL + "/v1/print-diagnostics";
const outcomes: Record<TestResult["outcome"], string> = {
  simulated: "Virtual spool verified",
  "socket-sent": "Test bytes sent to the printer socket",
  "not-sent": "Connection failed before sending",
  uncertain: "Outcome unknown · check the station before retrying",
};

function when(date: string) {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(date));
}

export function PrinterStation() {
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<PrinterStatus>;
      })
      .then(data => { setStatus(data); setMessage(""); })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus(null);
          setMessage("The local printer service is unavailable. Start the local API, then refresh.");
        }
      });
    return () => controller.abort();
  }, [refresh]);

  async function simulate() {
    if (!status || busy) return;
    setBusy(true);
    setMessage("");
    try {
      requestId.current ??= crypto.randomUUID();
      const response = await fetch(endpoint + "/simulate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: requestId.current }),
      });
      if (!response.ok) throw new Error();
      const result: TestResult = await response.json();
      setStatus(current => current && ({ ...current, lastSimulator: result }));
      setMessage(outcomes[result.outcome]);
      requestId.current = null;
    } catch {
      setMessage("The test result could not be retrieved. Retry to check the same specimen.");
    } finally { setBusy(false); }
  }

  const last = status?.lastSimulator;
  const hardware = status?.lastHardware;
  return <section id="printer-station" className="ops-printer-station" aria-labelledby="printer-station-heading">
    <header className="ops-section-heading"><h2 id="printer-station-heading">Kitchen printer</h2>
      <button className="ops-text-button" type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh status</button>
    </header>
    <div className="ops-printer-columns">
      <div><h3>Physical station</h3>
        <p>{!status ? "Awaiting local station status." : status.setup === "configured" ? "LAN address configured. Verify a test slip at the printer." :
          status.setup === "invalid" ? "Check the printer address and port on the bridge." :
          hardware ? "A hardware test was recorded from the bridge command line." : "Printer address has not been configured."}</p>
        {hardware && <p><strong>Latest hardware test</strong><br />{outcomes[hardware.outcome]}<br />{when(hardware.created)} · Toronto</p>}
        {status?.paperObservedAt && <p>Paper observed by the operator on {when(status.paperObservedAt)} · Toronto</p>}
        <Link href="/staff/printer-guide/" className="ops-text-button">Open printer setup guide <span aria-hidden="true">→</span></Link>
      </div>
      <div><h3>Test ticket</h3><p>Render a fixed kitchen ticket into the local virtual spool and verify the saved bytes.</p>
        <button type="button" className="ops-button" onClick={simulate} disabled={busy || !status}>{busy ? "Checking…" : "Run simulator test"}</button>
        {last && <details key={last.id}><summary>View latest specimen</summary><p>{outcomes[last.outcome]} · {when(last.created)} Toronto</p><pre>{last.ticket}</pre></details>}
      </div>
    </div>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
