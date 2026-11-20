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
const torontoClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const bookingTimeGroups = [{ label: "Morning", start: 0, end: 12 }, { label: "Afternoon", start: 12, end: 17 }, { label: "Evening", start: 17, end: 24 }];
const dayMilliseconds = 86_400_000;

function wallClock(instant: number) {
  const parts = Object.fromEntries(torontoClock.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function bookableTimes<T extends { value: string }>(date: string, hours: T[], cutoff: number) {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const offsets = new Set([midnight - dayMilliseconds, midnight + dayMilliseconds].map(instant => Date.parse(`${wallClock(instant)}Z`) - instant));
  return hours.filter(({ value }) => {
    const local = `${date}T${value}`;
    const wallTime = Date.parse(`${local}Z`);
    // On daylight saving transitions some local times occur twice or do not occur at all.
    const instants = Array.from(offsets, offset => wallTime - offset).filter(instant => wallClock(instant) === local);
    return instants.length === 1 && instants[0] >= cutoff;
  });
}

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
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [dateError, setDateError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const { earliest, latest } = bookingDateRange(config);
  const settings = config.reservationSettings;
  const paused = settings?.paused === true;
  const lead = config.minLeadMinutes ?? 60;
  const maxPartySize = config.maxPartySize ?? 20;
  const step = config.timeStepMinutes ?? 15;
  const hours = Array.from({ length: 1440 / step }, (_, index) => {
    const minutes = index * step;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, label: `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "a.m." : "p.m."}`, hour };
  }).filter(time => time.value >= (settings?.firstTime ?? "00:00") && time.value <= (settings?.lastTime ?? "23:45"));
  const cutoff = now + lead * 60_000;
  const firstDayTimes = bookableTimes(earliest, hours, cutoff);
  const nextDay = new Date(Date.parse(`${earliest}T00:00:00Z`) + dayMilliseconds).toISOString().slice(0, 10);
  const firstBookableDate = firstDayTimes.length ? earliest : nextDay;
  const min = firstBookableDate > latest ? latest : firstBookableDate;
  const date = preferredDate >= firstBookableDate && preferredDate <= latest && !settings?.closures.some(closure => closure.date === preferredDate) ? preferredDate : "";
  const times = date && date !== earliest ? bookableTimes(date, hours, cutoff) : firstDayTimes;
  const time = date && times.some(entry => entry.value === preferredTime) ? preferredTime : "";
  const canBook = availability === "ready" && !paused && hours.length > 0 && firstBookableDate <= latest;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canBook) return;
    if (!date) { setDateError(true); return; }
    if (!time) return;
    const submittedAt = Date.now();
    if (!bookableTimes(date, [{ value: time }], submittedAt + lead * 60_000).length) {
      setNow(submittedAt);
      return;
    }
    const data = new FormData(event.currentTarget);
    await send({
      name: field(data, "name"),
      email: field(data, "email"),
      phone: field(data, "phone"),
      date,
      time,
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
    <form className="guest-contact-form guest-booking-form" data-paused={paused || undefined} onSubmit={submit}>
      {(paused || settings?.notice) && <div className="guest-booking-notice" role="status">
        {paused && <strong>Online reservations are paused.</strong>}
        {settings?.notice && <p>{settings.notice}</p>}
        {paused && <p><a href="tel:+16135911111">Call (613) 591-1111</a> for help with a reservation.</p>}
      </div>}
      <fieldset className="guest-booking-layout" disabled={busy || paused} hidden={paused}>
        <div className="guest-booking-date">
          <h3>Choose a date</h3>
          <ReservationCalendar min={min} max={latest} value={date} closures={settings?.closures} onChange={value => {
            if (value !== preferredDate) setPreferredTime("");
            setPreferredDate(value);
            setDateError(false);
          }} />
          {dateError && <p className="guest-contact-error" role="alert">Choose a date on the calendar.</p>}
          {!dateError && preferredDate && !date && <p className="guest-contact-form-hint" role="status">That date is no longer available. Choose another day.</p>}
          <p className="guest-contact-form-hint">Toronto time · Request at least {lead} minutes ahead.</p>
        </div>
        <div className="guest-booking-details">
          <h3>Reservation details</h3>
          <div className="guest-contact-schedule" data-date-selected={date ? "true" : undefined}>
          <label>Preferred time
            <select key={date} name="time" value={time} onChange={event => setPreferredTime(event.target.value)} disabled={!date || !canBook || times.length === 0} required>
              <option value="" disabled>{date ? "Choose a time" : "Choose a date first"}</option>
              {date && bookingTimeGroups.map(group => {
                const entries = times.filter(entry => entry.hour >= group.start && entry.hour < group.end);
                return entries.length > 0 && <optgroup key={group.label} label={group.label}>
                  {entries.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </optgroup>;
              })}
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
        {date && canBook && (times.length === 0 || (preferredTime && !time)) && <p className="guest-contact-form-hint" role="status">
          {times.length === 0 ? "No times are available that day. Choose another date." : "That time is no longer available. Choose another time."}
        </p>}
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
          <div className="guest-booking-actions">
            {date && time && <p className="guest-booking-selection" aria-live="polite">{formatReservationTime(date, time)} Toronto time</p>}
            <button className="guest-contact-submit" type="submit" disabled={!canBook}>{busy ? "Sending request…" : "Request a table"} <span aria-hidden="true">→</span></button>
          </div>
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
    let pending: AbortController | null = null;
    function checkConfig() {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      guestServiceRequest<GuestServiceConfig>("guest-services/config", { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setConfig(result); })
        .catch(() => { if (!controller.signal.aborted) setConfig(null); })
        .finally(() => { if (!controller.signal.aborted) { pending = null; setChecked(true); } });
    }
    checkConfig();
    if (reservationOnly) window.addEventListener("focus", checkConfig);
    return () => {
      pending?.abort();
      window.removeEventListener("focus", checkConfig);
    };
  }, [reservationOnly]);

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
