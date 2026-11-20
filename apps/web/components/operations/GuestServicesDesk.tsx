"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { authRequest, refreshCustomer, useCustomer } from "../../lib/customer-session";
import {
  bookingDateRange,
  formatReservationTime,
  GuestServiceError,
  guestServiceRequest,
  reservationStates,
  torontoTimestamp,
  type GuestNotification,
  type ReservationAction,
  type ReservationStatus,
  type StaffContact,
  type StaffReservation,
} from "../../lib/guest-services";
import { ManagerSignIn } from "./ManagerSignIn";
import { OperationsShell } from "./OperationsShell";

type DeskTab = "reservations" | "contact";
type Scope = "active" | "all";
type ReservationPage = { reservations: StaffReservation[]; nextCursor: string | null };
type ContactPage = { contacts: StaffContact[]; nextCursor: string | null };
type SaveReservation = { reservation: StaffReservation } & GuestNotification;
type DeskState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

function useDeskPage<T>(path: string) {
  const [state, setState] = useState<DeskState<T>>({ kind: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    guestServiceRequest<T>(path, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ kind: "ready", data });
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        const status = cause instanceof GuestServiceError ? cause.status : null;
        setState({
          kind: "error",
          message: status === 403
            ? "This workspace requires a restaurant manager account."
            : status === 401
              ? "Your session has ended. Sign in again."
              : "This workspace is temporarily unavailable.",
        });
        if (status === 401) void refreshCustomer();
      });
    return () => controller.abort();
  }, [path, reload]);

  function refresh() {
    setState({ kind: "loading" });
    setReload(version => version + 1);
  }

  return { state, refresh };
}

const actionLabels: Record<ReservationAction, string> = {
  CONFIRM: "Confirm request",
  RESCHEDULE: "Change date, time or party",
  DECLINE: "Decline request",
  CANCEL: "Cancel reservation",
};

const allowedActions: Record<ReservationStatus, readonly ReservationAction[]> = {
  REQUESTED: ["CONFIRM", "RESCHEDULE", "DECLINE", "CANCEL"],
  CONFIRMED: ["RESCHEDULE", "CANCEL"],
  DECLINED: [],
  CANCELLED: [],
};

function ReservationBadge({ status }: { status: ReservationStatus }) {
  return <span className="guest-desk-badge" data-status={status}>{reservationStates[status]}</span>;
}

function GuestDetails({ name, email, phone }: { name: string; email: string; phone: string | null }) {
  return (
    <dl className="guest-desk-contact-details">
      <div><dt>Name</dt><dd>{name}</dd></div>
      <div><dt>Email</dt><dd><a href={`mailto:${email}`}>{email}</a></dd></div>
      {phone && <div><dt>Phone</dt><dd><a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></dd></div>}
    </dl>
  );
}

function ReservationUpdate({ reservation, onSave }: {
  reservation: StaffReservation;
  onSave(message: string): void;
}) {
  const actions = allowedActions[reservation.status];
  const [action, setAction] = useState<ReservationAction>(actions[0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const dateRange = bookingDateRange({});
  const reschedule = action === "RESCHEDULE";
  const noteRequired = action === "DECLINE" || action === "CANCEL";

  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const data = new FormData(event.currentTarget);
    const body = {
      version: reservation.version,
      action,
      message: String(data.get("message") ?? "").trim(),
      ...(reschedule ? {
        date: String(data.get("date")),
        time: String(data.get("time")),
        partySize: Number(data.get("partySize")),
      } : {}),
    };
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage("");

    try {
      const result = await guestServiceRequest<SaveReservation>(
        `auth/admin/reservations/${encodeURIComponent(reservation.id)}`,
        { body, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const change = action === "RESCHEDULE" ? "updated" : reservationStates[result.reservation.status].toLowerCase();
      const notice = result.emailQueued ? "Email queued." : "Email delivery requires configuration. Contact the guest by phone.";
      onSave(`${reservation.number} ${change}. ${notice}`);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const status = cause instanceof GuestServiceError ? cause.status : null;
      if (status === 409) {
        onSave("Another team member updated this booking. Review its current details.");
      } else if (status === 401 || status === 403) {
        onSave("Access changed. Sign in as a restaurant manager to continue.");
      } else {
        setMessage(cause instanceof GuestServiceError
          ? cause.message
          : "Couldn’t verify the update. Refresh the list to check the latest status before retrying.");
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <form className="guest-desk-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Manage booking</legend>
        <label>
          Action
          <select value={action} onChange={event => setAction(event.target.value as ReservationAction)}>
            {actions.map(next => <option key={next} value={next}>{actionLabels[next]}</option>)}
          </select>
        </label>
        {reschedule && (
          <div className="guest-desk-schedule">
            <label>Date<input name="date" type="date" min={dateRange.earliest} max={dateRange.latest} defaultValue={reservation.date} required /></label>
            <label>Time<input name="time" type="time" step={900} defaultValue={reservation.time} required /></label>
            <label>Party size<input name="partySize" type="number" min={1} max={20} defaultValue={reservation.partySize} required /></label>
          </div>
        )}
        <label>
          <span>Message to guest {!noteRequired && <small>Optional</small>}</span>
          <textarea name="message" rows={3} maxLength={500} required={noteRequired} />
        </label>
        {message && <p className="guest-desk-error" role="alert">{message}</p>}
        <button className="ops-button" type="submit">{busy ? "Saving…" : actionLabels[action]} <span aria-hidden="true">→</span></button>
      </fieldset>
    </form>
  );
}

function DeskPaging({ canGoBack, nextCursor, onBack, onNext }: {
  canGoBack: boolean;
  nextCursor: string | null;
  onBack(): void;
  onNext(cursor: string): void;
}) {
  if (!canGoBack && !nextCursor) return null;
  return (
    <nav className="guest-desk-pagination" aria-label="Results pages">
      <button className="ops-text-button" disabled={!canGoBack} onClick={onBack}>← Newer</button>
      <button className="ops-text-button" disabled={!nextCursor} onClick={() => nextCursor && onNext(nextCursor)}>Older →</button>
    </nav>
  );
}

function DeskFeedback({ state, refresh }: { state: { kind: "loading" } | { kind: "error"; message: string }; refresh(): void }) {
  if (state.kind === "loading") return <p className="guest-desk-empty" role="status">Loading…</p>;
  return (
    <div className="guest-desk-empty" role="alert">
      <p>{state.message}</p>
      <button className="ops-text-button" onClick={refresh}>Try again</button>
    </div>
  );
}

type PageNavigation = {
  cursor: string;
  canGoBack: boolean;
  onBack(): void;
  onNext(next: string): void;
};

function ReservationList({ scope, cursor, ...navigation }: PageNavigation & { scope: Scope }) {
  const params = new URLSearchParams({ scope });
  if (cursor) params.set("after", cursor);
  const { state, refresh } = useDeskPage<ReservationPage>(`auth/admin/reservations?${params}`);
  const [selection, setSelection] = useState("");
  const [feedback, setFeedback] = useState("");
  const detail = useRef<HTMLElement>(null);
  const reservations = state.kind === "ready" ? state.data.reservations : [];
  const selected = reservations.find(item => item.id === selection) ?? reservations[0];

  return (
    <>
      <div className="guest-desk-list-tools">
        <span>All times in Toronto</span>
        <button className="ops-text-button" onClick={refresh}>Refresh</button>
      </div>
      {feedback && <p className="guest-desk-feedback" role="status">{feedback}</p>}
      {state.kind !== "ready" ? <DeskFeedback state={state} refresh={refresh} /> : (
        <>
          {selected ? (
            <div className="guest-desk-split">
              <ul className="guest-desk-rows" aria-label="Reservations">
                {reservations.map(reservation => (
                    <li key={reservation.id}>
                      <button type="button" aria-pressed={selected.id === reservation.id} onClick={() => {
                        setSelection(reservation.id);
                        if (window.matchMedia("(max-width: 760px)").matches) detail.current?.focus();
                      }}>
                        <span><strong>{reservation.name}</strong><small>{reservation.number} · {reservation.partySize} {reservation.partySize === 1 ? "guest" : "guests"}</small></span>
                        <span><ReservationBadge status={reservation.status} /><small>{formatReservationTime(reservation.date, reservation.time)}</small></span>
                      </button>
                    </li>
                  ))}
              </ul>
              <aside className="guest-desk-detail" tabIndex={-1} ref={detail} aria-label="Booking details">
                <ReservationDetails
                  reservation={selected}
                  onSave={message => { setFeedback(message); refresh(); }}
                />
              </aside>
            </div>
          ) : <p className="guest-desk-empty">No {scope === "active" ? "active reservations" : "reservations"} on this page.</p>}
          <DeskPaging {...navigation} nextCursor={state.data.nextCursor} />
        </>
      )}
    </>
  );
}

function ReservationDetails({ reservation, onSave }: { reservation: StaffReservation; onSave(message: string): void }) {
  return (
    <>
      <div className="guest-desk-detail-heading">
        <h2>{reservation.number}</h2>
        <ReservationBadge status={reservation.status} />
      </div>
      <p>{formatReservationTime(reservation.date, reservation.time)} · {reservation.partySize} {reservation.partySize === 1 ? "guest" : "guests"}</p>
      <GuestDetails name={reservation.name} email={reservation.email} phone={reservation.phone} />
      {reservation.notes && <div className="guest-desk-note"><h3>Guest notes</h3><p>{reservation.notes}</p></div>}
      {reservation.lastMessage && <div className="guest-desk-note"><h3>Last message on file</h3><p>{reservation.lastMessage}</p></div>}
      <p className="guest-desk-date">Requested {torontoTimestamp.format(new Date(reservation.createdAt))}</p>
      {allowedActions[reservation.status].length > 0 && (
        <ReservationUpdate key={`${reservation.id}-${reservation.version}`} reservation={reservation} onSave={onSave} />
      )}
    </>
  );
}

function ContactList({ cursor, ...navigation }: PageNavigation) {
  const { state, refresh } = useDeskPage<ContactPage>(
    "auth/admin/contact" + (cursor ? `?after=${encodeURIComponent(cursor)}` : ""),
  );
  const [selection, setSelection] = useState("");
  const detail = useRef<HTMLElement>(null);
  const contacts = state.kind === "ready" ? state.data.contacts : [];
  const selected = contacts.find(item => item.id === selection) ?? contacts[0];

  return (
    <>
      <div className="guest-desk-list-tools">
        <span>Message inbox · Toronto time</span>
        <button className="ops-text-button" onClick={refresh}>Refresh</button>
      </div>
      {state.kind !== "ready" ? <DeskFeedback state={state} refresh={refresh} /> : (
        <>
          {selected ? (
            <div className="guest-desk-split">
              <ul className="guest-desk-rows" aria-label="Contact messages">
                {contacts.map(contact => (
                  <li key={contact.id}>
                    <button type="button" aria-pressed={selected.id === contact.id} onClick={() => {
                      setSelection(contact.id);
                      if (window.matchMedia("(max-width: 760px)").matches) detail.current?.focus();
                    }}>
                      <span><strong>{contact.subject || "Guest message"}</strong><small>{contact.name} · {contact.number}</small></span>
                      <small>{torontoTimestamp.format(new Date(contact.createdAt))}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <aside className="guest-desk-detail" tabIndex={-1} ref={detail} aria-label="Message details">
                <div className="guest-desk-detail-heading">
                  <h2>{selected.subject || "Guest message"}</h2>
                  <span className="guest-desk-date">{selected.number}</span>
                </div>
                <p className="guest-desk-date">Received {torontoTimestamp.format(new Date(selected.createdAt))}</p>
                <GuestDetails name={selected.name} email={selected.email} phone={selected.phone} />
                <div className="guest-desk-note"><h3>Message</h3><p>{selected.message}</p></div>
              </aside>
            </div>
          ) : <p className="guest-desk-empty">No messages on this page.</p>}
          <DeskPaging {...navigation} nextCursor={state.data.nextCursor} />
        </>
      )}
    </>
  );
}

function GuestDeskViews() {
  const [tab, setTab] = useState<DeskTab>("reservations");
  const [scope, setScope] = useState<Scope>("active");
  const [pages, setPages] = useState([""]);
  const cursor = pages.at(-1) ?? "";
  const navigation: PageNavigation = {
    cursor,
    canGoBack: pages.length > 1,
    onBack: () => setPages(current => current.slice(0, -1)),
    onNext: next => setPages(current => [...current, next]),
  };
  return (
    <>
      <nav className="guest-desk-tabs" aria-label="Guest services views">
        <button type="button" aria-pressed={tab === "reservations"} onClick={() => {
          if (tab !== "reservations") { setTab("reservations"); setPages([""]); }
        }}>Reservations</button>
        <button type="button" aria-pressed={tab === "contact"} onClick={() => {
          if (tab !== "contact") { setTab("contact"); setPages([""]); }
        }}>Contact inbox</button>
      </nav>
      {tab === "reservations" ? (
        <>
          <div className="guest-desk-scopes" role="group" aria-label="Filter reservations">
            <button type="button" aria-pressed={scope === "active"} onClick={() => {
              if (scope !== "active") { setScope("active"); setPages([""]); }
            }}>Active</button>
            <button type="button" aria-pressed={scope === "all"} onClick={() => {
              if (scope !== "all") { setScope("all"); setPages([""]); }
            }}>All bookings</button>
          </div>
          <ReservationList key={`${scope}-${cursor}`} scope={scope} {...navigation} />
        </>
      ) : <ContactList key={cursor} {...navigation} />}
    </>
  );
}

export default function GuestServicesDesk() {
  const user = useCustomer();
  const [error, setError] = useState("");
  return (
    <OperationsShell active="reservations">
      <main className="ops-main guest-desk" id="main-content" tabIndex={-1}>
        <header className="guest-desk-heading">
          <div><p>Front of house</p><h1>Reservations</h1></div>
          {user && (
            <div className="guest-desk-session">
              <span>{user.name}</span>
              <button className="ops-text-button" onClick={async () => {
                try { await authRequest("logout"); setError(""); }
                catch { setError("Couldn’t confirm sign-out. Try again."); }
              }}>Sign out</button>
            </div>
          )}
        </header>
        {error && <p className="guest-desk-error" role="alert">{error}</p>}
        {user
          ? <GuestDeskViews key={user.id} />
          : <ManagerSignIn description="Sign in to review table requests and guest messages." />}
      </main>
    </OperationsShell>
  );
}
