import { useEffect, useState } from "react";
import type { DemoPrintJob } from "@wok/domain/training";
import { API_URL } from "../../lib/customer-session";

export function TrainingSlip({ orderNumber, job }: { orderNumber: string; job: DemoPrintJob }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || payload) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(API_URL + "/v1/training/operations/slips/" + encodeURIComponent(job.id), { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const text = await response.text();
        if (!controller.signal.aborted) { setError(""); setPayload(text); }
      } catch {
        if (!controller.signal.aborted) setError("Could not load the saved slip.");
      }
    }
    void load();
    return () => controller.abort();
  }, [open, payload, job.id, attempt]);
  const title = job.kind === "ORIGINAL" ? "Original training slip" : "Training reprint · Copy " + job.copy;
  return <details className="ops-saved-slip" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}</summary>
    {payload ? <>
      <pre>{payload}</pre>
      <a download={`training-${orderNumber}-${job.copy ? "copy-" + job.copy : "original"}.txt`} href={"data:text/plain;charset=utf-8," + encodeURIComponent(payload)}>Download text slip</a>
    </> : error ? <p role="status">{error} <button type="button" className="ops-text-button" onClick={() => { setError(""); setAttempt(current => current + 1); }}>Retry</button></p> : open && <p role="status">Loading slip…</p>}
  </details>;
}
