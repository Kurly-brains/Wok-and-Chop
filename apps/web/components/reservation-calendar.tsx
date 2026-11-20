"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ReservationAvailability } from "../lib/guest-services";
import "../styles/reservation-calendar.css";

type CalendarProps = {
  min: string;
  max: string;
  value: string;
  closures?: Readonly<ReservationAvailability["closures"]>;
  onChange(date: string): void;
};

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "long", year: "numeric" });
const dayLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", dateStyle: "full" });
const closureLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });

function civilDate(date: string) {
  return new Date(date + "T00:00:00Z");
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const day = civilDate(date);
  day.setUTCDate(day.getUTCDate() + days);
  return isoDate(day);
}

function addMonths(date: string, months: number) {
  const day = civilDate(date);
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth() + months;
  const monthLength = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(year, month, Math.min(day.getUTCDate(), monthLength))));
}

export default function ReservationCalendar({ min, max, value, closures = [], onChange }: CalendarProps) {
  const [position, setPosition] = useState(() => ({ selection: value, day: value || min }));
  const selectedButton = useRef<HTMLButtonElement>(null);
  const focusOnMove = useRef(false);
  const monthId = useId();
  const adviceId = useId();
  const closureListId = useId();
  const clamp = (date: string) => date < min ? min : date > max ? max : date;
  const focusedDay = clamp(position.selection === value ? position.day : value || min);
  const monthStart = focusedDay.slice(0, 7) + "-01";
  const firstWeekday = civilDate(monthStart).getUTCDay();
  const monthLength = civilDate(addDays(addMonths(monthStart, 1), -1)).getUTCDate();
  const firstGridDay = addDays(monthStart, -firstWeekday);
  const monthTitle = monthLabel.format(civilDate(monthStart));
  const canGoBack = min.slice(0, 7) < monthStart.slice(0, 7);
  const canGoForward = max.slice(0, 7) > monthStart.slice(0, 7);
  const monthClosures = closures.filter(closure => closure.date >= min && closure.date <= max && closure.date.slice(0, 7) === monthStart.slice(0, 7));
  const closed = new Map(monthClosures.map(closure => [closure.date, closure.notice]));

  useLayoutEffect(() => {
    if (!focusOnMove.current) return;
    focusOnMove.current = false;
    selectedButton.current?.focus({ preventScroll: true });
  }, [focusedDay]);

  function browse(months: number) {
    setPosition({ selection: value, day: clamp(addMonths(focusedDay, months)) });
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    let target;
    const weekday = civilDate(day).getUTCDay();
    switch (event.key) {
      case "ArrowLeft": target = addDays(day, -1); break;
      case "ArrowRight": target = addDays(day, 1); break;
      case "ArrowUp": target = addDays(day, -7); break;
      case "ArrowDown": target = addDays(day, 7); break;
      case "Home": target = addDays(day, -weekday); break;
      case "End": target = addDays(day, 6 - weekday); break;
      case "PageUp": target = addMonths(day, event.shiftKey ? -12 : -1); break;
      case "PageDown": target = addMonths(day, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault();
    const nextDay = clamp(target);
    if (nextDay === focusedDay) return;
    focusOnMove.current = true;
    setPosition({ selection: value, day: nextDay });
  }

  return (
    <div className="reservation-calendar">
      <div className="reservation-calendar-header">
        <button
          type="button"
          aria-label="Previous month"
          aria-disabled={!canGoBack}
          onClick={() => { if (canGoBack) browse(-1); }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <strong id={monthId} aria-live="polite">{monthTitle}</strong>
        <button
          type="button"
          aria-label="Next month"
          aria-disabled={!canGoForward}
          onClick={() => { if (canGoForward) browse(1); }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <p id={adviceId} className="reservation-calendar-advice">
        Use the arrow keys to move between dates. Press Enter or Space to select a date.
      </p>
      <table role="grid" aria-labelledby={monthId} aria-describedby={adviceId}>
        <thead>
          <tr>{weekdays.map(day => <th key={day} scope="col" abbr={day}>{day.slice(0, 3)}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.ceil((firstWeekday + monthLength) / weekdays.length) }, (_, week) => {
            const start = addDays(firstGridDay, week * 7);
            return (
              <tr key={start}>
                {weekdays.map((_, offset) => {
                  const date = addDays(start, offset);
                  if (date.slice(0, 7) !== monthStart.slice(0, 7)) return <td key={date} />;
                  const day = civilDate(date);
                  const enabled = date >= min && date <= max;
                  const isClosed = closed.has(date);
                  return (
                    <td key={date} aria-selected={enabled && !isClosed ? value === date : undefined}>
                      <button
                        type="button"
                        disabled={!enabled}
                        aria-disabled={isClosed || undefined}
                        ref={focusedDay === date ? selectedButton : undefined}
                        tabIndex={focusedDay === date ? 0 : -1}
                        aria-label={`${dayLabel.format(day)}${isClosed ? ", closed" : ""}`}
                        aria-describedby={isClosed ? `${closureListId}-${date}` : undefined}
                        data-closed={isClosed || undefined}
                        onFocus={() => {
                          if (date !== focusedDay) setPosition({ selection: value, day: date });
                        }}
                        onKeyDown={event => moveWithKeyboard(event, date)}
                        onClick={() => {
                          if (isClosed) return;
                          setPosition({ selection: date, day: date });
                          onChange(date);
                        }}
                      >
                        {day.getUTCDate()}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {monthClosures.length > 0 && <div className="reservation-calendar-closures">
        <strong>Closed dates</strong>
        <ul>
          {monthClosures.map(closure => <li key={closure.date}>
            <time dateTime={closure.date}>{closureLabel.format(civilDate(closure.date))}</time>
            <span id={`${closureListId}-${closure.date}`}>{closure.notice || "Closed for reservations"}</span>
          </li>)}
        </ul>
      </div>}
    </div>
  );
}
