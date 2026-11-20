"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import {
  getCookiePreference,
  setCookiePreference,
  useCookiePreference,
} from "../lib/cookie-preferences";
import "../styles/cookie-settings.css";

const dialogId = "wok-cookie-settings";
const photosId = "wok-cookie-photos";

function openCookieSettings() {
  const settings = document.getElementById(dialogId);
  if (!(settings instanceof HTMLDialogElement) || settings.open) return;
  const photos = document.getElementById(photosId);
  if (photos instanceof HTMLInputElement)
    photos.checked = getCookiePreference() === "external";
  settings.showModal();
}

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      aria-controls={dialogId}
      onClick={openCookieSettings}
    >
      Cookie settings
    </button>
  );
}

export default function CookieSettings() {
  const choice = useCookiePreference();
  const pathname = usePathname();
  const publicPage = !/^\/(staff|kitchen)(?:\/|$)/.test(pathname);
  const dialog = useRef<HTMLDialogElement>(null);
  const externalPhotos = useRef<HTMLInputElement>(null);

  function save(allowPhotos: boolean) {
    setCookiePreference(allowPhotos ? "external" : "essential");
    dialog.current?.close();
  }

  return (
    <>
      {choice === null && publicPage && (
        <section
          className="wc-cookie-banner"
          aria-labelledby="cookie-banner-title"
        >
          <div>
            <h2 id="cookie-banner-title">Your cookie choices</h2>
            <p>
              Essential storage keeps your bag and sign-in working. Google
              review photos are optional.
            </p>
          </div>
          <div className="wc-cookie-actions">
            <button type="button" onClick={() => save(false)}>
              Essential only
            </button>
            <button type="button" onClick={() => save(true)}>
              Allow optional
            </button>
            <CookieSettingsButton className="wc-cookie-settings-link" />
          </div>
        </section>
      )}

      <dialog
        ref={dialog}
        id={dialogId}
        className="wc-cookie-dialog"
        aria-labelledby="cookie-dialog-title"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save(externalPhotos.current?.checked === true);
          }}
        >
          <header>
            <h2 id="cookie-dialog-title">Cookie and privacy settings</h2>
            <button
              type="button"
              className="wc-cookie-close"
              aria-label="Close cookie settings"
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </header>
          <div className="wc-cookie-option">
            <strong>Essential storage</strong>
            <span className="wc-cookie-essential">Always on</span>
            <p>
              Keeps your account session, bag and checkout working and remembers
              this preference.
            </p>
          </div>
          <label className="wc-cookie-option">
            <strong id="cookie-photo-label">Google review photos</strong>
            <input
              type="checkbox"
              id={photosId}
              ref={externalPhotos}
              aria-labelledby="cookie-photo-label"
              aria-describedby="cookie-photo-description"
            />
            <span id="cookie-photo-description">
              Lets your browser load guest photos and avatars from Google.
            </span>
          </label>
          <div className="wc-cookie-actions">
            <button type="button" onClick={() => save(false)}>
              Essential only
            </button>
            <button type="submit" className="wc-cookie-primary">
              Save preferences
            </button>
          </div>
          <Link
            className="wc-cookie-privacy-link"
            href="/privacy/#cookies"
            onClick={() => dialog.current?.close()}
          >
            Read the privacy policy
          </Link>
        </form>
      </dialog>
    </>
  );
}
