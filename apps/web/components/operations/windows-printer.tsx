"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "../../lib/customer-session";
import "../../styles/windows-printer.css";

type JobStatus = "SENDING" | "SPOOLED" | "FAILED" | "UNKNOWN";
type Job = {
  id: string;
  kind: "TEST" | "PICKUP_KITCHEN";
  orderId: string | null;
  orderNumber: string | null;
  status: JobStatus;
  queueName: string;
  createdAt: string;
  updatedAt: string;
  detail: string;
};
type PrinterStatus = {
  mode: "WINDOWS_QUEUE";
  configured: boolean;
  queueName: string | null;
  available: boolean;
  ready: boolean;
  physicalOutputVerified: false;
  detail: string;
  jobs: Job[];
};
type Target = "test" | `pickups/${string}`;
type Outcome = {
  state: PrinterStatus | null;
  error: string;
  needsManager: boolean;
};

const endpoint = `${API_URL}/v1/auth/admin/printer`;
const managerSignIn = "/staff/sign-in/?next=printer";
const guide = "/staff/printer-guide/";
const statusLabels: Record<JobStatus, string> = {
  SENDING: "Sending to Windows",
  SPOOLED: "Accepted by Windows",
  FAILED: "Couldn’t send",
  UNKNOWN: "Output unknown",
};
const torontoTime = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});

class PrinterRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function printerRequest<T>(path = "", options?: RequestInit): Promise<T> {
  const response = await fetch(endpoint + path, {
    ...options,
    credentials: "include",
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result)
    throw new PrinterRequestError(
      typeof result?.message === "string"
        ? result.message
        : "The local printer service is unavailable.",
      response.status,
    );
  return result as T;
}

function readRequest(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveRequest(key: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem(key, id);
    else sessionStorage.removeItem(key);
  } catch {
    /* The current panel also keeps the identifier in memory. */
  }
}

function useWindowsPrinter(target: Target) {
  const [loaded, setLoaded] = useState<Outcome>();
  const [refresh, setRefresh] = useState(0);
  const [job, setJob] = useState<Job>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(false);
  const request = useRef<string | null>(null);
  const sending = useRef(false);
  const storageKey = "wok-managed-print:" + target;

  useEffect(() => {
    const controller = new AbortController();
    void printerRequest<PrinterStatus>("", { signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        setLoaded({ state, error: "", needsManager: false });
        setRetry(Boolean(request.current ?? readRequest(storageKey)));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const needsManager =
          error instanceof PrinterRequestError &&
          [401, 403].includes(error.status);
        setLoaded({
          state: null,
          needsManager,
          error: needsManager
            ? ""
            : "Check that the local Windows API is running, then refresh the status.",
        });
      });
    return () => controller.abort();
  }, [refresh, storageKey]);

  function check() {
    setLoaded(undefined);
    setMessage("");
    setRefresh((value) => value + 1);
  }

  async function send(newTest = false) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (newTest) request.current = null;
      const id =
        request.current ??
        (newTest ? null : readRequest(storageKey)) ??
        crypto.randomUUID();
      request.current = id;
      saveRequest(storageKey, id);
      const result = await printerRequest<{ job: Job }>("/" + target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id }),
      });
      setJob(result.job);
      const checkLater =
        result.job.status === "SENDING" || result.job.status === "UNKNOWN";
      setRetry(checkLater);
      if (!checkLater) {
        request.current = null;
        saveRequest(storageKey, null);
      }
      setRefresh((value) => value + 1);
    } catch (error) {
      setRetry(true);
      setMessage(
        error instanceof PrinterRequestError
          ? error.message + " You can retry the same request."
          : "Couldn’t confirm the queue response. Retry the same request to check it.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return { loaded, job, busy, message, retry, check, send };
}

function ReceiptStatus({ job }: { job: Job }) {
  return (
    <div
      className="windows-print-result"
      data-status={job.status}
      role="status"
    >
      <strong>{statusLabels[job.status]}</strong>
      {job.status === "SPOOLED" && (
        <span>Check the printer for the paper slip.</span>
      )}
      {job.status === "UNKNOWN" && (
        <span>
          Check for paper and inspect the Windows queue before another print.
        </span>
      )}
      {job.status === "FAILED" && <span>{job.detail}</span>}
      {job.status === "SENDING" && (
        <span>Refresh the status to see the queue result.</span>
      )}
    </div>
  );
}

export function WindowsPrinterPanel() {
  const printer = useWindowsPrinter("test");
  const { loaded, busy, message, retry, check, send } = printer;
  const state = loaded?.state;
  const latest = state?.jobs.find((job) => job.kind === "TEST");
  const job =
    latest && (!printer.job || latest.updatedAt >= printer.job.updatedAt)
      ? latest
      : printer.job;
  const needsPaperCheck = job?.status === "UNKNOWN";
  const sending = job?.status === "SENDING";

  return (
    <section
      className="windows-printer-panel"
      aria-labelledby="windows-printer-title"
      aria-busy={!loaded || busy}
    >
      <header className="windows-printer-panel-head">
        <h2 id="windows-printer-title">Printer status</h2>
        <button
          className="ops-text-button"
          type="button"
          onClick={check}
          disabled={busy || !loaded}
        >
          Refresh status
        </button>
      </header>
      {!loaded && <p role="status">Checking the Windows printer…</p>}
      {loaded?.needsManager && (
        <>
          <p>
            Manager access is required to view the queue and test the printer.
          </p>
          <Link className="ops-button" href={managerSignIn}>
            Manager sign in <span aria-hidden="true">→</span>
          </Link>
        </>
      )}
      {loaded?.error && <p role="alert">{loaded.error}</p>}
      {state && (
        <>
          <dl className="windows-printer-facts">
            <div>
              <dt>Windows queue</dt>
              <dd>{state.queueName ?? "Choose a printer in setup"}</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>
                {state.ready
                  ? "Ready for a test"
                  : state.available
                    ? "Queue needs attention"
                    : "Unavailable"}
              </dd>
            </div>
          </dl>
          {(!state.ready || !state.configured) && <p>{state.detail}</p>}
          <div className="windows-printer-test">
            <h3>Send a test slip</h3>
            <p>
              Stand beside the connected printer. The test slip is marked “Do
              not prepare.”
            </p>
            <button
              className="ops-button"
              type="button"
              disabled={
                busy ||
                !state.ready ||
                Boolean(sending) ||
                Boolean(needsPaperCheck)
              }
              onClick={() => void send()}
            >
              {busy
                ? "Sending request…"
                : needsPaperCheck
                  ? "Check paper before another test"
                  : retry
                    ? "Retry the same test request"
                    : "Send test slip"}
            </button>
            {job && <ReceiptStatus job={job} />}
            {needsPaperCheck && (
              <details className="windows-printer-recovery">
                <summary>I checked the queue and the printer</summary>
                <p>
                  Start a separate marked test only after checking for pending
                  output.
                </p>
                <button
                  type="button"
                  className="ops-text-button"
                  disabled={busy || !state.ready}
                  onClick={() => void send(true)}
                >
                  Start a new test
                </button>
              </details>
            )}
            {message && <p role="alert">{message}</p>}
          </div>
        </>
      )}
      {Boolean(state?.jobs.length) && (
        <div className="windows-printer-jobs">
          <h3>Recent print jobs</h3>
          <ul>
            {state?.jobs.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>
                    {entry.kind === "TEST"
                      ? "Test slip"
                      : `Pickup ${entry.orderNumber ?? "ticket"}`}
                  </strong>
                  <time dateTime={entry.updatedAt}>
                    {torontoTime.format(new Date(entry.updatedAt))}
                  </time>
                </div>
                <span>{statusLabels[entry.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function PickupPrinterControl({ orderId }: { orderId: string }) {
  const printer = useWindowsPrinter(`pickups/${encodeURIComponent(orderId)}`);
  const { loaded, busy, message, retry, send, check } = printer;
  const state = loaded?.state;
  const recent = state?.jobs.find(
    (entry) => entry.kind === "PICKUP_KITCHEN" && entry.orderId === orderId,
  );
  const job =
    recent && (!printer.job || recent.updatedAt >= printer.job.updatedAt)
      ? recent
      : printer.job;

  return (
    <div className="pickup-print-action">
      {!loaded && <p role="status">Checking the kitchen printer…</p>}
      {loaded && !job && state?.ready && (
        <button
          type="button"
          className="ops-button"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy
            ? "Sending request…"
            : retry
              ? "Retry the same print request"
              : "Print kitchen slip"}
        </button>
      )}
      {job && <ReceiptStatus job={job} />}
      {job?.status === "SENDING" && (
        <button
          type="button"
          className="ops-text-button"
          onClick={check}
          disabled={!loaded || busy}
        >
          Refresh print status
        </button>
      )}
      {message && <p role="alert">{message}</p>}
      {loaded && !state?.ready && !job && (
        <p>
          Kitchen printer unavailable.{" "}
          <Link href={guide}>Open printer setup</Link> or save the slip below.
        </p>
      )}
      {job && (job.status === "FAILED" || job.status === "UNKNOWN") && (
        <p>
          Check <Link href={guide}>printer setup</Link> or save the slip below.
        </p>
      )}
    </div>
  );
}
