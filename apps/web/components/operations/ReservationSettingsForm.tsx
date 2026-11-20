"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  bookingDateRange,
  guestServiceRequest,
  type ReservationSettings,
} from "../../lib/guest-services";
import "../../styles/reservation-settings.css";

const route = "auth/admin/reservations/settings/";
const readableDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  dateStyle: "full",
});

export function ReservationSettingsForm() {
  const [settings, setSettings] = useState<ReservationSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [closingDate, setClosingDate] = useState("");
  const [dateNotice, setDateNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void guestServiceRequest<ReservationSettings>(route, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setSettings(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load booking settings.",
          );
      });
    return () => controller.abort();
  }, [revision]);

  function reload() {
    setError("");
    setResult("");
    setSettings(null);
    setRevision((value) => value + 1);
  }

  function addClosure() {
    if (!settings || !closingDate) return;
    setError("");
    setResult("");
    const closure = { date: closingDate, notice: dateNotice.trim() };
    setSettings({
      ...settings,
      closures: [
        ...settings.closures.filter(({ date }) => date !== closingDate),
        closure,
      ].sort((first, second) => first.date.localeCompare(second.date)),
    });
    setClosingDate("");
    setDateNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || pending) return;
    setError("");
    setResult("");
    setPending(true);
    const { version, ...availability } = settings;
    if (closingDate) {
      availability.closures = [
        ...availability.closures.filter(({ date }) => date !== closingDate),
        { date: closingDate, notice: dateNotice.trim() },
      ];
    }
    try {
      const saved = await guestServiceRequest<ReservationSettings>(route, {
        body: { expectedVersion: version, ...availability },
      });
      setSettings(saved);
      setClosingDate("");
      setDateNotice("");
      setResult("Booking settings updated.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save booking settings.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!settings)
    return error ? (
      <div role="alert">
        <p>{error}</p>
        <button className="ops-text-button" onClick={reload}>
          Try again
        </button>
      </div>
    ) : (
      <p role="status">Loading booking settings…</p>
    );

  return (
    <form className="wc-booking-settings" onSubmit={save}>
      <fieldset disabled={pending}>
        <section aria-labelledby="booking-settings-availability">
          <div>
            <h2 id="booking-settings-availability">Online availability</h2>
            <p>
              Set the daily first and last times guests can request a table.
              Times are in Toronto.
            </p>
          </div>
          <div className="wc-booking-settings-fields">
            <label className="wc-booking-pause">
              <input
                type="checkbox"
                checked={settings.paused}
                onChange={(event) =>
                  setSettings({ ...settings, paused: event.target.checked })
                }
              />
              Pause new online bookings
            </label>
            <div className="wc-booking-hours">
              <label>
                First booking
                <input
                  type="time"
                  step={900}
                  required
                  value={settings.firstTime}
                  onChange={(event) =>
                    setSettings({ ...settings, firstTime: event.target.value })
                  }
                />
              </label>
              <label>
                Last booking
                <input
                  type="time"
                  step={900}
                  required
                  value={settings.lastTime}
                  onChange={(event) =>
                    setSettings({ ...settings, lastTime: event.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Guest notice <small>Optional</small>
              <textarea
                rows={3}
                maxLength={280}
                value={settings.notice}
                onChange={(event) =>
                  setSettings({ ...settings, notice: event.target.value })
                }
                placeholder="Displayed above the booking calendar"
              />
            </label>
          </div>
        </section>
        <section aria-labelledby="booking-settings-closures">
          <div>
            <h2 id="booking-settings-closures">Date closures</h2>
            <p>
              Close dates individually. Review existing bookings for those dates
              in Reservations.
            </p>
          </div>
          <div className="wc-booking-settings-fields">
            <div className="wc-booking-closure-entry">
              <label>
                Date to close
                <input
                  type="date"
                  min={bookingDateRange({ minLeadMinutes: 0 }).earliest}
                  value={closingDate}
                  onChange={(event) => setClosingDate(event.target.value)}
                />
              </label>
              <label>
                Closure notice <small>Optional</small>
                <input
                  value={dateNotice}
                  onChange={(event) => setDateNotice(event.target.value)}
                  maxLength={280}
                  placeholder="e.g. Closed for a private event"
                />
              </label>
              <button
                type="button"
                className="ops-button ops-button-outline"
                onClick={addClosure}
                disabled={!closingDate}
              >
                Add closed date
              </button>
            </div>
            {settings.closures.length > 0 ? (
              <ul className="wc-booking-closure-list">
                {settings.closures.map((closure) => (
                  <li key={closure.date}>
                    <div>
                      <strong>
                        {readableDate.format(
                          new Date(`${closure.date}T00:00:00Z`),
                        )}
                      </strong>
                      {closure.notice && <p>{closure.notice}</p>}
                    </div>
                    <button
                      type="button"
                      className="ops-text-button"
                      onClick={() =>
                        setSettings({
                          ...settings,
                          closures: settings.closures.filter(
                            ({ date }) => date !== closure.date,
                          ),
                        })
                      }
                    >
                      Reopen date
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wc-booking-settings-empty">No dates closed.</p>
            )}
          </div>
        </section>
        <div className="wc-booking-settings-actions">
          <button type="submit" className="ops-button">
            {pending ? "Saving…" : "Save booking settings"}
          </button>
          {error && (
            <>
              <p role="alert">{error}</p>
              <button
                type="button"
                className="ops-text-button"
                onClick={reload}
              >
                Reload saved settings
              </button>
            </>
          )}
          <p role="status">{result}</p>
        </div>
      </fieldset>
    </form>
  );
}
