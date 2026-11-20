import { useEffect, useRef, useState } from "react";
import {
  statusNames,
  type ManagerDelivery,
  type ManagerQueue,
} from "../../lib/manager-deliveries";

type Action = "undo" | "archive" | "note";

export function PickupManagement({
  order,
  queue,
}: {
  order: ManagerDelivery;
  queue: ManagerQueue;
}) {
  const [operation, setOperation] = useState<{
    action: Action;
    version: number;
  } | null>(null);
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const canArchive =
    order.status === "PICKED_UP" || order.status === "CANCELLED";
  const canUndo =
    !order.archived && order.canUndoStatus && order.undoTargetStatus;
  const undo = operation?.action === "undo";
  const note = operation?.action === "note";
  const archiving = operation?.action === "archive";
  const ticketChanged = Boolean(
    operation && operation.version !== order.version,
  );

  useEffect(() => {
    if (undo || note) field.current?.focus();
    else if (archiving) confirmation.current?.focus();
  }, [undo, note, archiving]);

  function start(action: Action, button: HTMLButtonElement) {
    opener.current = button;
    setText(action === "note" ? (order.managerNote ?? "") : "");
    setOperation({ action, version: order.version });
  }

  function close() {
    setOperation(null);
    opener.current?.focus();
  }

  return (
    <section className="delivery-pickup-management" aria-label="Manage pickup">
      <h3>Manage pickup</h3>
      {order.managerNote && (
        <p className="delivery-manager-note">
          <strong>Manager note</strong>
          {order.managerNote}
        </p>
      )}
      <div className="delivery-management-actions">
        {canUndo && (
          <button
            type="button"
            className="ops-text-button"
            disabled={queue.saving}
            aria-expanded={undo}
            onClick={(event) => start("undo", event.currentTarget)}
          >
            Undo last status
          </button>
        )}
        {canArchive && (
          <button
            type="button"
            className="ops-text-button"
            disabled={queue.saving}
            aria-expanded={archiving}
            onClick={(event) => start("archive", event.currentTarget)}
          >
            {order.archived ? "Restore order" : "Archive order"}
          </button>
        )}
        <button
          type="button"
          className="ops-text-button"
          disabled={queue.saving}
          aria-expanded={note}
          onClick={(event) => start("note", event.currentTarget)}
        >
          {order.managerNote ? "Edit manager note" : "Add manager note"}
        </button>
      </div>
      {operation && (
        <form
          className="delivery-management-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (ticketChanged || queue.saving) return;
            const trimmed = text.trim();
            if (undo && !trimmed) return;
            const action = undo
              ? ({ type: "undo", reason: trimmed } as const)
              : note
                ? ({ type: "note", note: trimmed } as const)
                : ({ type: "archive", archived: !order.archived } as const);
            if (await queue.managePickup(order, action)) close();
          }}
        >
          {archiving ? (
            <p ref={confirmation} tabIndex={-1}>
              {order.archived
                ? `Move ${order.number} back to order history?`
                : `Move ${order.number} to the archive? You can restore it from Archived orders.`}
            </p>
          ) : (
            <label>
              {undo ? "Reason for undo" : "Manager note"}
              <textarea
                ref={field}
                rows={3}
                maxLength={undo ? 500 : 1000}
                required={undo}
                value={text}
                onChange={(event) => setText(event.target.value)}
                disabled={queue.saving}
              />
            </label>
          )}
          {undo && canUndo && (
            <p>
              {order.number} will return to{" "}
              <strong>{statusNames[canUndo]}</strong>.
            </p>
          )}
          {note && (
            <p>
              Visible in the staff order desk. Clear the field to remove the
              note.
            </p>
          )}
          {ticketChanged && !queue.saving && (
            <p role="status">
              The ticket changed. Close this form and review the latest details.
            </p>
          )}
          <div className="delivery-management-actions">
            <button
              type="submit"
              className="ops-button"
              disabled={queue.saving || ticketChanged || (undo && !text.trim())}
            >
              {queue.saving
                ? "Saving…"
                : undo
                  ? "Confirm status undo"
                  : note
                    ? "Save note"
                    : order.archived
                      ? "Confirm restore"
                      : "Confirm archive"}
            </button>
            <button
              type="button"
              className="ops-text-button"
              disabled={queue.saving}
              onClick={close}
            >
              Close
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
