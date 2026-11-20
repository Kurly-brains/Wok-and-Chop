"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCustomer } from "../../lib/customer-session";
import {
  GuestServiceError,
  guestServiceRequest,
  torontoTimestamp,
} from "../../lib/guest-services";
import { readPickupSession, writePickupSession } from "../../lib/pickup";
import { staffSignInUrl } from "../../lib/staff-routes";
import { OperationsShell } from "./OperationsShell";
import "../../styles/staff-marketing.css";

type Draft = { subject: string; message: string };
type Campaign = Draft & {
  id: string;
  createdAt: string;
  recipientCount: number;
};
type MarketingData = {
  emailEnabled: boolean;
  subscriberCount: number;
  campaigns: Campaign[];
};
type ReviewedDraft = Draft & { requestId: string; pendingKey: string };

const endpoint = "auth/admin/marketing";
const sender = "info@wokandchop.ca";
const emptyDraft: Draft = { subject: "", message: "" };
const subjectLimit = 120;
const messageLimit = 3000;

function recipients(count: number) {
  return `${count.toLocaleString("en-CA")} ${count === 1 ? "subscriber" : "subscribers"}`;
}

async function draftRequest(
  draft: Draft,
  managerId: string,
): Promise<ReviewedDraft> {
  const pendingKey = `wok-marketing-pending:${managerId}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(draft)),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const [lastFingerprint, lastId] = readPickupSession(pendingKey).split(":");
  const requestId =
    lastFingerprint === fingerprint && lastId ? lastId : crypto.randomUUID();
  writePickupSession(pendingKey, `${fingerprint}:${requestId}`);
  return { ...draft, pendingKey, requestId };
}

function CampaignHistory({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <section
      className="staff-marketing-history"
      aria-labelledby="marketing-history-title"
    >
      <h2 id="marketing-history-title">Campaign history</h2>
      {campaigns.length ? (
        <ul>
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <details>
                <summary>
                  <strong>{campaign.subject}</strong>
                  <time dateTime={campaign.createdAt}>
                    {torontoTimestamp.format(new Date(campaign.createdAt))}
                  </time>
                  <span>{recipients(campaign.recipientCount)} queued</span>
                </summary>
                <p>{campaign.message}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p>No email offers have been queued yet.</p>
      )}
    </section>
  );
}

export function StaffMarketing() {
  const customer = useCustomer();
  const confirmation = useRef<HTMLDialogElement>(null);
  const confirmationTitle = useRef<HTMLHeadingElement>(null);
  const mutation = useRef<AbortController | null>(null);
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [review, setReview] = useState<ReviewedDraft | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [needsManager, setNeedsManager] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    guestServiceRequest<MarketingData>(endpoint, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          typeof result.emailEnabled !== "boolean" ||
          !Number.isSafeInteger(result.subscriberCount) ||
          !Array.isArray(result.campaigns)
        ) {
          throw new Error(
            "The marketing service returned an invalid response.",
          );
        }
        setData(result);
        setLoadError("");
        setNeedsManager(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const restricted =
          cause instanceof GuestServiceError &&
          (cause.status === 401 || cause.status === 403);
        setData(null);
        setNeedsManager(restricted);
        setLoadError(
          restricted
            ? "Sign in as a restaurant manager to use Marketing."
            : "Could not load the mailing list and campaign history.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (review && !confirmation.current?.open) {
      confirmation.current?.showModal();
      confirmationTitle.current?.focus();
    }
  }, [review]);

  const mayQueue =
    !loading &&
    data?.emailEnabled &&
    data.subscriberCount > 0 &&
    Boolean(customer);
  const normalizedDraft = {
    subject: draft.subject.trim(),
    message: draft.message.trim(),
  };

  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }

  async function reviewEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !mayQueue ||
      !customer ||
      busy ||
      !normalizedDraft.subject ||
      !normalizedDraft.message
    )
      return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const reviewed = await draftRequest(normalizedDraft, customer.id);
      setReview(reviewed);
    } catch {
      setError("Could not open the campaign review. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function queueEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError("");
    try {
      const { subject, message, requestId, pendingKey } = review;
      const campaign = await guestServiceRequest<Campaign>(endpoint, {
        body: { requestId, subject, message },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (
        typeof campaign.id !== "string" ||
        !Number.isSafeInteger(campaign.recipientCount) ||
        campaign.recipientCount < 1
      ) {
        throw new Error("Could not confirm the campaign queue.");
      }
      setData(
        (current) =>
          current && {
            ...current,
            campaigns: [
              campaign,
              ...current.campaigns.filter((item) => item.id !== campaign.id),
            ].slice(0, 50),
          },
      );
      writePickupSession(pendingKey, "");
      setReview(null);
      setUncertain(false);
      setDraft(emptyDraft);
      setNotice(`Offer queued for ${recipients(campaign.recipientCount)}.`);
      confirmation.current?.close();
    } catch (cause) {
      if (controller.signal.aborted) return;
      const unknownResult =
        !(cause instanceof GuestServiceError) || cause.status >= 500;
      setUncertain((previous) => previous || unknownResult);
      setError(
        unknownResult
          ? "Could not confirm that the offer was queued. Retry this same campaign to check safely."
          : cause.message,
      );
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function closeReview() {
    if (busy) return;
    if (!uncertain) {
      setError("");
      setReview(null);
    }
    confirmation.current?.close();
  }

  return (
    <OperationsShell active="marketing">
      <main className="staff-marketing" id="main-content" tabIndex={-1}>
        <header className="staff-marketing-head">
          <div>
            <h1>Marketing</h1>
            <p>Send offers and menu updates to guests who signed up.</p>
          </div>
          <Link href="/offers/">
            View signup page <span aria-hidden="true">↗</span>
          </Link>
        </header>
        {loadError && (
          <p className="staff-marketing-alert" role="alert">
            {loadError}{" "}
            {needsManager ? (
              <Link href={staffSignInUrl("marketing")}>Staff sign-in</Link>
            ) : (
              <button
                type="button"
                className="ops-text-button"
                disabled={loading}
                onClick={refresh}
              >
                Try again
              </button>
            )}
          </p>
        )}
        <section
          className="staff-marketing-audience"
          aria-label="Mailing list and email availability"
        >
          <div>
            <span>Mailing list</span>
            <strong>
              {data
                ? recipients(data.subscriberCount)
                : loading
                  ? "Loading…"
                  : "Unavailable"}
            </strong>
          </div>
          <div>
            <span>From</span>
            <strong>{sender}</strong>
          </div>
          <div>
            <span>Email setup</span>
            <strong className={data?.emailEnabled ? "marketing-enabled" : ""}>
              {data ? (data.emailEnabled ? "Enabled" : "Setup required") : "—"}
            </strong>
          </div>
          {data && (
            <button
              type="button"
              className="ops-text-button"
              disabled={loading || busy}
              onClick={refresh}
            >
              Refresh list
            </button>
          )}
        </section>
        {data && !data.emailEnabled && (
          <p className="staff-marketing-alert">
            Campaigns can be queued once email is configured for this workspace.
          </p>
        )}
        {data?.emailEnabled && data.subscriberCount === 0 && (
          <p className="staff-marketing-alert">
            Campaigns can be queued once guests join the mailing list.
          </p>
        )}
        <p className="staff-marketing-notice" role="status">
          {notice}
        </p>
        <div className="staff-marketing-layout">
          <form className="staff-marketing-compose" onSubmit={reviewEmail}>
            <h2>Write an offer</h2>
            <label>
              Subject
              <input
                required
                maxLength={subjectLimit}
                value={draft.subject}
                disabled={busy || uncertain}
                onChange={(event) =>
                  setDraft({ ...draft, subject: event.target.value })
                }
                placeholder="Email subject"
              />
            </label>
            <label>
              Message
              <textarea
                required
                rows={8}
                maxLength={messageLimit}
                value={draft.message}
                disabled={busy || uncertain}
                onChange={(event) =>
                  setDraft({ ...draft, message: event.target.value })
                }
                placeholder="Write your offer here"
              />
            </label>
            <p className="staff-marketing-limit">
              {draft.message.length.toLocaleString("en-CA")} / 3,000 characters
            </p>
            {error && !review && (
              <p className="staff-marketing-alert" role="alert">
                {error}
              </p>
            )}
            {uncertain ? (
              <>
                <p className="staff-marketing-alert" role="status">
                  The last queue request is unconfirmed. Refresh the list or
                  retry the same campaign.
                </p>
                <button
                  type="button"
                  className="ops-button"
                  onClick={() => {
                    confirmation.current?.showModal();
                    confirmationTitle.current?.focus();
                  }}
                >
                  Return to campaign review
                </button>
              </>
            ) : (
              <button
                type="submit"
                className="ops-button"
                disabled={
                  !mayQueue ||
                  busy ||
                  !normalizedDraft.subject ||
                  !normalizedDraft.message
                }
              >
                Review email <span aria-hidden="true">→</span>
              </button>
            )}
          </form>
          <aside
            className="staff-marketing-preview"
            aria-labelledby="marketing-preview-title"
          >
            <h2 id="marketing-preview-title">Email preview</h2>
            <div className="staff-marketing-envelope">
              <p>
                Wok &amp; Chop <span>&lt;{sender}&gt;</span>
              </p>
              <strong>
                {normalizedDraft.subject || "Your subject goes here"}
              </strong>
              <div>
                {normalizedDraft.message ||
                  "Your message will appear here as you write."}
              </div>
              <footer>
                790 Kanata Ave, Unit M2A, Kanata, Ontario · Unsubscribe link
                included
              </footer>
            </div>
          </aside>
        </div>
        {data && <CampaignHistory campaigns={data.campaigns} />}
        <dialog
          ref={confirmation}
          className="staff-marketing-confirm"
          aria-labelledby="marketing-confirm-title"
          onCancel={(event) => {
            event.preventDefault();
            closeReview();
          }}
        >
          {review && (
            <form onSubmit={queueEmail}>
              <h2
                id="marketing-confirm-title"
                tabIndex={-1}
                ref={confirmationTitle}
              >
                Queue this email offer?
              </h2>
              {data && (
                <p>
                  Current mailing list: {recipients(data.subscriberCount)}. The
                  final recipient count is checked when the offer is queued.
                </p>
              )}
              <strong className="staff-marketing-confirm-subject">
                {review.subject}
              </strong>
              <p className="staff-marketing-confirm-body">{review.message}</p>
              {error && (
                <p className="staff-marketing-alert" role="alert">
                  {error}
                </p>
              )}
              <div className="staff-marketing-confirm-actions">
                <button type="submit" className="ops-button" disabled={busy}>
                  {busy
                    ? "Queuing…"
                    : uncertain
                      ? "Retry same campaign"
                      : "Confirm and queue email"}
                </button>
                <button
                  type="button"
                  className="ops-text-button"
                  disabled={busy}
                  onClick={closeReview}
                >
                  {uncertain ? "Close" : "Back to draft"}
                </button>
              </div>
            </form>
          )}
        </dialog>
      </main>
    </OperationsShell>
  );
}
