"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  bookingDateRange,
  formatReservationTime,
  GuestServiceError,
  guestServiceRequest,
  reservationStates,
  type GuestNotification,
  type GuestServiceConfig,
  type ReservationReceipt,
} from "../lib/guest-services";
import InkInscription from "./ink-inscription";
import ReservationCalendar from "./reservation-calendar";
import "../styles/guest-contact-forms.css";

type ContactReceipt = { number: string; status: "RECEIVED" };

function useGuestSubmission<Receipt>(path: string, getReceipt: (response: unknown) => Receipt | undefined) {
  const submission = useRef<{ payload: string; id: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function send(body: object) {
    if (request.current) return;
    const payload = JSON.stringify(body);
    if (submission.current?.payload !== payload) {
      submission.current = { payload, id: crypto.randomUUID() };
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");

    try {
      const response = await guestServiceRequest(path, {
        body: { ...body, requestId: submission.current.id },
        signal: controller.signal,
      });
      const confirmed = getReceipt(response);
      if (!confirmed) throw new Error("Invalid receipt");
      if (!controller.signal.aborted) setReceipt(confirmed);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof GuestServiceError && cause.status < 500
          ? cause.message
          : "We couldn’t confirm your request. Try again with the same details.",
      );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function reset() {
    submission.current = null;
    setReceipt(null);
    setError("");
  }

  return { send, reset, busy, error, receipt };
}

function reservationReceipt(response: unknown) {
  const result = response as GuestNotification & { reservation?: ReservationReceipt };
  const receipt = result?.reservation;
  return receipt && Object.hasOwn(reservationStates, receipt.status) && typeof receipt.number === "string"
    && typeof receipt.partySize === "number" && /^\d{4}-\d{2}-\d{2}$/.test(receipt.date)
    && /^\d{2}:\d{2}$/.test(receipt.time)
    ? { ...receipt, emailQueued: result.emailQueued }
    : undefined;
}

function contactReceipt(response: unknown) {
  const result = response as GuestNotification & { contact?: ContactReceipt };
  const receipt = result?.contact;
  return receipt?.status === "RECEIVED" && typeof receipt.number === "string"
    ? { ...receipt, emailQueued: result.emailQueued }
    : undefined;
}

function field(data: FormData, key: string) {
  return String(data.get(key) ?? "").trim();
}

function Confirmation({ title, children, onReset }: { title: string; children: ReactNode; onReset(): void }) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => region.current?.focus({ preventScroll: true }), []);
  return (
    <div className="guest-contact-confirmation" tabIndex={-1} ref={region}>
      <h3>{title}</h3>
      {children}
      <button type="button" onClick={onReset}>Send another request</button>
    </div>
  );
}

function PhoneField({ required = false }: { required?: boolean }) {
  return (
    <label>
      <span>Phone number {!required && <small>Optional</small>}</span>
      <input name="phone" type="tel" autoComplete="tel" maxLength={25} required={required} />
    </label>
  );
}

function ReservationRequest({ config, availability }: { config: Partial<GuestServiceConfig>; availability: "checking" | "ready" | "closed" }) {
  const { send, reset, busy, error, receipt } = useGuestSubmission("reservations", reservationReceipt);
  const [date, setDate] = useState("");
  const [dateError, setDateError] = useState(false);
  const { earliest, latest } = bookingDateRange(config);
  const maxPartySize = config.maxPartySize ?? 20;
  const step = config.timeStepMinutes ?? 15;
  const times = Array.from({ length: 1440 / step }, (_, index) => {
    const minutes = index * step;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, label: `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "a.m." : "p.m."}`, hour };
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (availability !== "ready") return;
    if (!date) { setDateError(true); return; }
    const data = new FormData(event.currentTarget);
    await send({
      name: field(data, "name"),
      email: field(data, "email"),
      phone: field(data, "phone"),
      date,
      time: field(data, "time"),
      partySize: Number(field(data, "partySize")),
      notes: field(data, "notes"),
    });
  }

  if (receipt) return (
    <Confirmation title={receipt.status === "REQUESTED" ? "Table request received" : `Reservation ${reservationStates[receipt.status].toLowerCase()}`} onReset={reset}>
      <p><strong>{receipt.number}</strong> · {receipt.partySize} {receipt.partySize === 1 ? "guest" : "guests"}</p>
      <p>{formatReservationTime(receipt.date, receipt.time)} Toronto time</p>
      {receipt.status === "REQUESTED" && <p>Please wait for the restaurant to confirm before you come in.</p>}
      {receipt.emailQueued === true && <p>Receipt email queued.</p>}
      {receipt.emailQueued === false && <p>Your request was saved for staff to review.</p>}
    </Confirmation>
  );

  return (
    <form className="guest-contact-form guest-booking-form" onSubmit={submit}>
      <fieldset className="guest-booking-layout" disabled={busy}>
        <div className="guest-booking-date">
          <h3>Choose a date</h3>
          <ReservationCalendar min={earliest} max={latest} value={date} onChange={value => { setDate(value); setDateError(false); }} />
          {dateError && <p className="guest-contact-error" role="alert">Choose a date on the calendar.</p>}
          <p className="guest-contact-form-hint">Toronto time · Request at least {config.minLeadMinutes ?? 60} minutes ahead.</p>
        </div>
        <div className="guest-booking-details">
          <h3>Reservation details</h3>
          <div className="guest-contact-schedule">
          <label>Preferred time
            <select name="time" key={date} defaultValue="" required>
              <option value="" disabled>Choose a time</option>
              {[["Morning", 0, 12], ["Afternoon", 12, 17], ["Evening", 17, 24]].map(([group, start, end]) => (
                <optgroup key={group} label={String(group)}>
                  {times.filter(time => time.hour >= Number(start) && time.hour < Number(end)).map(time => <option key={time.value} value={time.value}>{time.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Party size
            <select name="partySize" defaultValue="" required>
              <option value="" disabled>Choose size</option>
              {Array.from({ length: maxPartySize }, (_, index) => index + 1).map(partySize => (
                <option key={partySize} value={partySize}>{partySize} {partySize === 1 ? "guest" : "guests"}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="guest-contact-fields">
          <label>Full name<input name="name" autoComplete="name" maxLength={80} required /></label>
          <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <PhoneField required />
          <label className="guest-contact-notes-field">
            <span>Anything we should know? <small>Optional</small></span>
            <textarea name="notes" maxLength={1000} rows={3} />
          </label>
        </div>
          {availability !== "ready" && <p className="guest-contact-fallback" role="status">{availability === "checking" ? "Checking online booking…" : "Online booking is temporarily unavailable."}</p>}
          {error && <p className="guest-contact-error" role="alert">{error}</p>}
          <button className="guest-contact-submit" type="submit" disabled={availability !== "ready"}>{busy ? "Sending request…" : "Request a table"} <span aria-hidden="true">→</span></button>
        </div>
      </fieldset>
    </form>
  );
}

function ContactRequest({ availability }: { availability: "checking" | "ready" | "closed" }) {
  const { send, reset, busy, error, receipt } = useGuestSubmission("contact", contactReceipt);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (availability !== "ready") return;
    const data = new FormData(event.currentTarget);
    await send({
      name: field(data, "name"),
      email: field(data, "email"),
      phone: field(data, "phone"),
      subject: field(data, "subject"),
      message: field(data, "message"),
    });
  }

  if (receipt) return (
    <Confirmation title="Message received" onReset={reset}>
      <p>Your message reference is <strong>{receipt.number}</strong>.</p>
      {receipt.emailQueued === true && <p>Receipt email queued.</p>}
      {receipt.emailQueued === false && <p>Your message was saved for staff.</p>}
    </Confirmation>
  );

  return (
    <form className="guest-contact-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <div className="guest-contact-fields">
          <label>Full name<input name="name" autoComplete="name" maxLength={80} required /></label>
          <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <PhoneField />
          <label>
            <span>Subject <small>Optional</small></span>
            <input name="subject" maxLength={120} />
          </label>
          <label className="guest-contact-notes-field">
            Your message
            <textarea name="message" minLength={10} maxLength={3000} rows={5} required />
          </label>
        </div>
        {availability !== "ready" && <p className="guest-contact-fallback" role="status">{availability === "checking" ? "Checking online messages…" : "The message form is temporarily unavailable."}</p>}
        {error && <p className="guest-contact-error" role="alert">{error}</p>}
        <button className="guest-contact-submit" type="submit" disabled={availability !== "ready"}>{busy ? "Sending message…" : "Send message"} <span aria-hidden="true">→</span></button>
      </fieldset>
    </form>
  );
}

export function BookingSection() {
  return <GuestContactForms reservationOnly />;
}

export default function GuestContactForms({ reservationOnly = false }: { reservationOnly?: boolean }) {
  const [config, setConfig] = useState<GuestServiceConfig | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    guestServiceRequest<GuestServiceConfig>("guest-services/config", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setConfig(result); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setChecked(true); });
    return () => controller.abort();
  }, []);

  return (
    <div className={`guest-contact-forms${reservationOnly ? " guest-contact-forms--booking" : ""}`}>
      {config?.mode === "LOCAL_PREVIEW" && (config.reservationsEnabled || (!reservationOnly && config.contactEnabled)) && (
        <p className="guest-contact-preview">Online forms are in preview. Use sample contact details.</p>
      )}
      {reservationOnly ? <section className="guest-contact-card guest-booking-card" id="book-a-table" aria-labelledby="book-a-table-title">
        <header>
          <InkInscription>請坐</InkInscription>
          <h2 id="book-a-table-title">Book a table.</h2>
          <p>Choose your preferred date and time. The restaurant will confirm your reservation after reviewing it.</p>
        </header>
        <ReservationRequest config={config ?? {}} availability={!checked ? "checking" : config?.reservationsEnabled ? "ready" : "closed"} />
      </section> : <section className="guest-contact-card" id="contact-message" aria-labelledby="contact-message-title">
        <header>
          <InkInscription>聯絡</InkInscription>
          <h2 id="contact-message-title">Send a message.</h2>
          <p>Send the restaurant a question or feedback.</p>
        </header>
        <ContactRequest availability={!checked ? "checking" : config?.contactEnabled ? "ready" : "closed"} />
      </section>}
    </div>
  );
}
