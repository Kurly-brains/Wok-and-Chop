import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  formatMoney,
  isLunchMenuItem,
  priceLine,
  type CartSelection,
  type MenuItem,
} from "@wok/domain";
import { API_URL } from "../../lib/customer-session";
import { canAddDish, dishOptionGroups } from "../../lib/dish-options";
import { useMenuCatalog } from "../../lib/menu-catalog";
import {
  pickupTrackingCode,
  PickupRequestError,
  readPickupSession,
  requestPickup,
  writePickupSession,
  type PickupOrder,
  type PickupQuote,
} from "../../lib/pickup";

type Line = Required<CartSelection> & { key: string };
type Contact = { name: string; phone: string; email: string };
type Review = {
  contact: Contact;
  lines: CartSelection[];
  quote: PickupQuote;
  requestId: string;
};
type Receipt = { pickup: PickupOrder; trackingToken: string };

const emptyContact: Contact = { name: "", phone: "", email: "" };

function newLine(): Line {
  return {
    key: crypto.randomUUID(),
    itemId: "",
    quantity: 1,
    modifierIds: [],
    note: "",
  };
}

async function staffRequestId(pendingKey: string, payload: object) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const [storedFingerprint, storedId] =
    readPickupSession(pendingKey).split(":");
  if (storedFingerprint === fingerprint && storedId) return storedId;
  const requestId = crypto.randomUUID();
  writePickupSession(pendingKey, `${fingerprint}:${requestId}`);
  return requestId;
}

function DraftDish({
  line,
  dishes,
  index,
  change,
  remove,
}: {
  line: Line;
  dishes: readonly MenuItem[];
  index: number;
  change(update: Partial<Line>): void;
  remove: (() => void) | null;
}) {
  const item = dishes.find((dish) => dish.id === line.itemId);
  return (
    <fieldset className="staff-pickup-dish">
      <legend>Dish {index + 1}</legend>
      <div className="staff-pickup-dish-fields">
        <label>
          Dish
          <select
            required
            value={line.itemId}
            onChange={(event) =>
              change({ itemId: event.target.value, modifierIds: [] })
            }
          >
            <option value="" disabled>
              Select a dish
            </option>
            {line.itemId && !item && (
              <option value={line.itemId} disabled>
                Dish unavailable
              </option>
            )}
            {dishes.map((dish) => (
              <option key={dish.id} value={dish.id}>
                {dish.name} · {formatMoney(dish.priceCents)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input
            type="number"
            required
            min={1}
            max={20}
            value={line.quantity || ""}
            onChange={(event) =>
              change({ quantity: Number(event.target.value) })
            }
          />
        </label>
      </div>
      {item &&
        dishOptionGroups(item).map((group) => {
          const radio = group.min === 1 && group.max === 1;
          const selected = group.options.filter((option) =>
            line.modifierIds.includes(option.id),
          );
          return (
            <fieldset className="staff-pickup-options" key={group.id}>
              <legend>
                {group.name}{" "}
                <span>{group.min > 0 ? "Required" : "Optional"}</span>
              </legend>
              <div>
                {group.options
                  .filter((option) => option.available !== false)
                  .map((option) => (
                    <label key={option.id}>
                      <input
                        type={radio ? "radio" : "checkbox"}
                        name={`${line.key}-${group.id}`}
                        checked={line.modifierIds.includes(option.id)}
                        required={radio}
                        disabled={
                          !radio &&
                          selected.length >= group.max &&
                          !line.modifierIds.includes(option.id)
                        }
                        onChange={(event) => {
                          const modifierIds = radio
                            ? [
                                ...line.modifierIds.filter(
                                  (id) =>
                                    !group.options.some(
                                      (value) => value.id === id,
                                    ),
                                ),
                                option.id,
                              ]
                            : event.target.checked
                              ? [...line.modifierIds, option.id]
                              : line.modifierIds.filter(
                                  (id) => id !== option.id,
                                );
                          change({ modifierIds });
                        }}
                      />
                      {option.name}
                      {option.priceCents > 0 &&
                        ` +${formatMoney(option.priceCents)}`}
                    </label>
                  ))}
              </div>
            </fieldset>
          );
        })}
      <label>
        Kitchen note <span>(optional)</span>
        <textarea
          rows={2}
          maxLength={240}
          value={line.note}
          onChange={(event) => change({ note: event.target.value })}
        />
      </label>
      {remove && (
        <button
          type="button"
          className="ops-text-button"
          aria-label={`Remove dish ${index + 1}`}
          onClick={remove}
        >
          Remove dish
        </button>
      )}
    </fieldset>
  );
}

export function StaffPickupCreate({
  managerId,
  onCreated,
}: {
  managerId: string;
  onCreated(): void;
}) {
  const catalog = useMenuCatalog();
  const dishes = catalog.filter(
    (dish) => isLunchMenuItem(dish) && canAddDish(dish),
  );
  const pendingKey = `wok-chop:staff-pending-pickup:${managerId}`;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const requestActive = useRef(false);
  const [contact, setContact] = useState<Contact>(emptyContact);
  const [lines, setLines] = useState<Line[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (review || receipt) title.current?.focus();
  }, [review, receipt]);

  function open() {
    if (receipt) {
      setContact(emptyContact);
      setLines([newLine()]);
      setReview(null);
      setReceipt(null);
      setCopied(false);
      setError("");
    } else if (!lines.length) setLines([newLine()]);
    dialog.current?.showModal();
  }

  async function reviewOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestActive.current) return;
    requestActive.current = true;
    setError("");
    setBusy(true);
    try {
      const name = contact.name.trim();
      const phone = contact.phone
        .trim()
        .replace(/[ ()+.\-]/g, "")
        .replace(/^1(?=\d{10}$)/, "");
      if (!name || !/^[2-9]\d{2}[2-9]\d{6}$/.test(phone))
        throw new Error(
          "Enter the pickup name and a valid ten-digit phone number.",
        );
      const selections = lines.map((draft) => {
        const line = priceLine(draft, dishes);
        return {
          itemId: line.itemId,
          quantity: line.quantity,
          modifierIds: line.modifiers.map((option) => option.id),
          note: line.note,
        };
      });
      const quote = await requestPickup<PickupQuote>("/quote", {
        method: "POST",
        body: JSON.stringify({ lines: selections }),
        signal: AbortSignal.timeout(15000),
      });
      const person = { name, phone, email: contact.email.trim().toLowerCase() };
      const requestId = await staffRequestId(pendingKey, {
        contact: person,
        lines: selections,
        quote: quote.quoteFingerprint,
      });
      setReview({ contact: person, lines: selections, quote, requestId });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not review the pickup order. Try again.",
      );
    } finally {
      requestActive.current = false;
      setBusy(false);
    }
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || requestActive.current) return;
    requestActive.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/v1/auth/admin/pickups`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...review.contact,
          lines: review.lines,
          requestId: review.requestId,
          quoteFingerprint: review.quote.quoteFingerprint,
          expectedTotalCents: review.quote.totalCents,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new PickupRequestError(
          typeof result?.message === "string"
            ? result.message
            : "Pickup could not be saved.",
          response.status,
        );
      if (
        !result?.pickup?.number ||
        !pickupTrackingCode.test(result.trackingToken)
      )
        throw new Error("The order desk could not confirm the new ticket.");
      writePickupSession(pendingKey, "");
      setUncertain(false);
      setReview(null);
      setReceipt(result);
      onCreated();
    } catch (reason) {
      const ambiguous =
        !(reason instanceof PickupRequestError) || reason.status >= 500;
      setUncertain(ambiguous);
      setError(
        ambiguous
          ? "The save could not be confirmed. Check active orders or retry this ticket. Retrying uses the same request ID."
          : reason.message,
      );
    } finally {
      requestActive.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ops-button staff-pickup-open"
        onClick={open}
      >
        New pickup order <span aria-hidden="true">+</span>
      </button>
      <dialog
        ref={dialog}
        className="staff-pickup-dialog"
        aria-labelledby="staff-pickup-title"
        onCancel={(event) => {
          if (requestActive.current) event.preventDefault();
        }}
      >
        <div className="staff-pickup-dialog-head">
          <h2 id="staff-pickup-title" ref={title} tabIndex={-1}>
            {receipt
              ? `${receipt.pickup.number} created`
              : review
                ? "Review pickup order"
                : "New pickup order"}
          </h2>
          <button
            type="button"
            className="ops-text-button"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        {error && (
          <p className="staff-pickup-error" role="alert">
            {error}
          </p>
        )}
        {receipt ? (
          <div className="staff-pickup-success">
            <p>The ticket is in the active queue. Payment is due at pickup.</p>
            <p>Share this private pickup tracking code with the customer.</p>
            <code>{receipt.trackingToken}</code>
            <button
              type="button"
              className="ops-text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(receipt.trackingToken);
                  setCopied(true);
                } catch {
                  setError("Select and copy the tracking code manually.");
                }
              }}
            >
              {copied ? "Code copied" : "Copy tracking code"}
            </button>
          </div>
        ) : review ? (
          <form className="staff-pickup-entry" onSubmit={createOrder}>
            <p>
              <strong>{review.contact.name}</strong> · {review.contact.phone}
            </p>
            <ul className="staff-pickup-review">
              {review.quote.items.map((item, index) => (
                <li key={index}>
                  <span>
                    <strong>
                      {item.quantity} × {item.name}
                    </strong>
                    {item.modifiers.length > 0 && (
                      <small>{item.modifiers.join(" · ")}</small>
                    )}
                    {review.lines[index]?.note && (
                      <small>Kitchen note · {review.lines[index].note}</small>
                    )}
                  </span>
                  <strong>{formatMoney(item.lineTotalCents)}</strong>
                </li>
              ))}
            </ul>
            <p className="staff-pickup-total">
              <span>Food total · Pay at pickup</span>
              <strong>{formatMoney(review.quote.totalCents)}</strong>
            </p>
            <div className="delivery-management-actions">
              <button className="ops-button" disabled={busy}>
                {busy
                  ? "Saving…"
                  : uncertain
                    ? "Retry this ticket"
                    : "Create pickup order"}
              </button>
              {!uncertain && (
                <button
                  type="button"
                  className="ops-text-button"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setError("");
                  }}
                >
                  Edit pickup details
                </button>
              )}
            </div>
          </form>
        ) : (
          <form className="staff-pickup-entry" onSubmit={reviewOrder}>
            <fieldset className="staff-pickup-contact" disabled={busy}>
              <legend>Pickup customer</legend>
              <label>
                Name
                <input
                  required
                  autoComplete="off"
                  maxLength={80}
                  value={contact.name}
                  onChange={(event) =>
                    setContact({ ...contact, name: event.target.value })
                  }
                />
              </label>
              <label>
                Phone
                <input
                  required
                  autoComplete="off"
                  type="tel"
                  maxLength={32}
                  value={contact.phone}
                  onChange={(event) =>
                    setContact({ ...contact, phone: event.target.value })
                  }
                />
              </label>
              <label>
                Email for status updates <span>(optional)</span>
                <input
                  type="email"
                  autoComplete="off"
                  maxLength={254}
                  value={contact.email}
                  onChange={(event) =>
                    setContact({ ...contact, email: event.target.value })
                  }
                />
              </label>
            </fieldset>
            {dishes.length === 0 && <p>No dishes are available for pickup.</p>}
            <fieldset className="staff-pickup-lines" disabled={busy}>
              <legend className="ops-sr-only">Dishes for this pickup</legend>
              {lines.map((line, index) => (
                <DraftDish
                  key={line.key}
                  index={index}
                  line={line}
                  dishes={dishes}
                  change={(update) =>
                    setLines((current) =>
                      current.map((value) =>
                        value.key === line.key
                          ? { ...value, ...update }
                          : value,
                      ),
                    )
                  }
                  remove={
                    lines.length > 1
                      ? () =>
                          setLines((current) =>
                            current.filter((value) => value.key !== line.key),
                          )
                      : null
                  }
                />
              ))}
            </fieldset>
            <div className="delivery-management-actions">
              <button
                type="submit"
                className="ops-button"
                disabled={busy || !dishes.length}
              >
                {busy ? "Checking price…" : "Review order"}
              </button>
              <button
                type="button"
                className="ops-text-button"
                disabled={busy || lines.length >= 40 || !dishes.length}
                onClick={() => setLines((current) => [...current, newLine()])}
              >
                Add another dish
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
