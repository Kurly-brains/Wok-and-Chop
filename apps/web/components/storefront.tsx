"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  formatMoney,
  priceLine,
  normalizeNote,
  quotePromo,
  type MenuItem,
} from "@wok/domain";
import { useCart } from "../lib/cart-store";
import { useCustomer } from "../lib/customer-session";
import StoryContent from "./story-content";
import VisitContent from "./visit-content";
import AccountContent from "./account-content";
import DeliveryContent from "./delivery-content";
import { deliveryPromoKey, saveDeliverySession } from "../lib/delivery";
import HomeContent from "./home-content";
import FoodStories from "./food-stories";
import FooterFeast from "./footer-feast";
import { useScrollHeader } from "../lib/use-scroll-header";
import HomeExtras from "./home-extras";
import MenuContent from "./menu-content";
import { useMenuCatalog } from "../lib/menu-catalog";
import "../styles/bag.css";
import "../styles/brand-logo.css";
import "../styles/customer-art.css";

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Bag({ count }: { count: number }) {
  return (
    <>
      <svg
        width="19"
        height="21"
        viewBox="0 0 22 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 7h16l1 15H2L3 7ZM7 8V5a4 4 0 0 1 8 0v3"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <span>Your bag</span>
      <span className="bag-count">{count}</span>
    </>
  );
}

export default function Storefront({
  page = "home",
}: {
  page?: "home" | "menu" | "story" | "visit" | "account" | "delivery";
}) {
  const customer = useCustomer();
  const menuItems = useMenuCatalog();
  const scrolled = useScrollHeader();
  const [cart, setCart] = useCart();
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState("");
  const itemDialog = useRef<HTMLDialogElement>(null);
  const bagDialog = useRef<HTMLDialogElement>(null);
  const bagTitle = useRef<HTMLHeadingElement>(null);
  const bagBody = useRef<HTMLDivElement>(null);
  const bagPromo = useRef<HTMLDetailsElement>(null);
  const bagOpener = useRef<HTMLElement | null>(null);
  const bagOpenFrame = useRef<number | null>(null);
  const bagFocusFrame = useRef<number | null>(null);
  const bagCloseTimer = useRef<number | null>(null);
  const [bagAnnouncement, setBagAnnouncement] = useState("");

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(id);
  }, [message]);

  useEffect(() => {
    const dialog = bagDialog.current;
    return () => {
      if (bagOpenFrame.current !== null)
        cancelAnimationFrame(bagOpenFrame.current);
      if (bagFocusFrame.current !== null)
        cancelAnimationFrame(bagFocusFrame.current);
      if (bagCloseTimer.current !== null)
        window.clearTimeout(bagCloseTimer.current);
      if (dialog?.open) dialog.close();
    };
  }, []);

  const priced = cart.map((line) => ({
    ...priceLine(line, menuItems),
    key: line.key,
  }));
  const subtotal = priced.reduce((sum, line) => sum + line.lineTotalCents, 0);
  let discount = 0;
  let promoNotice = "";
  if (promoCode) {
    try {
      discount = quotePromo(promoCode, cart, menuItems, {
        preview: true,
      }).discountCents;
    } catch (error) {
      promoNotice =
        error instanceof Error
          ? error.message
          : "This offer cannot be applied.";
    }
  }
  function applyPromo(event: React.FormEvent) {
    event.preventDefault();
    setPromoError("");
    try {
      const promotion = quotePromo(promoInput, cart, menuItems, {
        preview: true,
      });
      setPromoCode(promotion.code);
      setPromoInput(promotion.code);
      setBagAnnouncement(`${promotion.code} applied to your bag.`);
      if (bagPromo.current) {
        bagPromo.current.open = false;
        bagPromo.current.querySelector("summary")?.focus();
      }
    } catch (error) {
      setPromoCode("");
      setPromoError(
        error instanceof Error ? error.message : "Please check this code.",
      );
    }
  }
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const selectedTotal = selected
    ? (selected.priceCents +
        (selected.modifierGroups
          ?.flatMap((group) => group.options)
          .filter((option) => modifiers.includes(option.id))
          .reduce((sum, option) => sum + option.priceCents, 0) ?? 0)) *
      quantity
    : 0;
  function openItem(item: MenuItem) {
    setSelected(item);
    setQuantity(1);
    setModifiers([]);
    setNote("");
    setFormError("");
    itemDialog.current?.showModal();
  }
  function addItem(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      if (cart.length >= 40)
        throw new Error("Your bag can hold up to 40 selections.");
      const selection = {
        itemId: selected.id,
        quantity,
        modifierIds: modifiers,
        note: normalizeNote(note),
      };
      priceLine(selection, menuItems);
      setCart((current) => [
        ...current,
        { ...selection, key: crypto.randomUUID() },
      ]);
      itemDialog.current?.close();
      setMessage(`${quantity} × ${selected.name} added to your bag.`);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Please check your selections.",
      );
    }
  }
  function adjust(key: string, delta: number) {
    const item = cart.find((line) => line.key === key);
    setCart((current) =>
      current.flatMap((line) =>
        line.key === key
          ? line.quantity + delta < 1
            ? []
            : [{ ...line, quantity: Math.min(20, line.quantity + delta) }]
          : [line],
      ),
    );
    if (item) {
      const name =
        menuItems.find((entry) => entry.id === item.itemId)?.name ?? "Item";
      const nextQuantity = Math.min(20, item.quantity + delta);
      setBagAnnouncement(
        nextQuantity < 1
          ? `${name} removed from your bag.`
          : `${name}: quantity ${nextQuantity}.`,
      );
      if (nextQuantity < 1) focusAfterBagRemoval();
    }
  }

  function focusAfterBagRemoval() {
    if (bagFocusFrame.current !== null)
      cancelAnimationFrame(bagFocusFrame.current);
    bagFocusFrame.current = requestAnimationFrame(() => {
      bagFocusFrame.current = null;
      if (
        !bagDialog.current?.open ||
        bagDialog.current.dataset.state === "closing"
      )
        return;
      const next = bagDialog.current.querySelector<HTMLElement>(
        ".wc-bag-lines button, .wc-bag-empty a",
      );
      (next ?? bagTitle.current)?.focus({ preventScroll: true });
    });
  }

  function removeBagItem(key: string, name: string) {
    setCart((current) => current.filter((line) => line.key !== key));
    setBagAnnouncement(`${name} removed from your bag.`);
    focusAfterBagRemoval();
  }

  function clearBagAnimation() {
    if (bagOpenFrame.current !== null)
      cancelAnimationFrame(bagOpenFrame.current);
    if (bagFocusFrame.current !== null)
      cancelAnimationFrame(bagFocusFrame.current);
    if (bagCloseTimer.current !== null)
      window.clearTimeout(bagCloseTimer.current);
    bagOpenFrame.current = null;
    bagFocusFrame.current = null;
    bagCloseTimer.current = null;
  }

  function openBag() {
    const dialog = bagDialog.current;
    if (!dialog) return;
    clearBagAnimation();
    setBagAnnouncement("");
    if (!dialog.open) {
      bagOpener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      delete dialog.dataset.state;
      dialog.showModal();
      if (bagBody.current) bagBody.current.scrollTop = 0;
      // Establish the off-screen starting position before the transition.
      dialog.getBoundingClientRect();
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.dataset.state = "open";
      bagTitle.current?.focus({ preventScroll: true });
      return;
    }
    bagOpenFrame.current = requestAnimationFrame(() => {
      bagOpenFrame.current = null;
      if (!dialog.open) return;
      dialog.dataset.state = "open";
      bagTitle.current?.focus({ preventScroll: true });
    });
  }

  function finishBagClose() {
    clearBagAnimation();
    bagDialog.current?.close();
  }

  function closeBag() {
    const dialog = bagDialog.current;
    if (!dialog?.open || dialog.dataset.state === "closing") return;
    clearBagAnimation();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishBagClose();
      return;
    }
    dialog.dataset.state = "closing";
    // Fallback for interrupted transitions or a backgrounded tab.
    bagCloseTimer.current = window.setTimeout(finishBagClose, 340);
  }

  function handleBagClosed() {
    // A close event can arrive after a rapid reopen; leave the new modal intact.
    if (bagDialog.current?.open) return;
    clearBagAnimation();
    if (bagDialog.current) delete bagDialog.current.dataset.state;
    if (bagOpener.current?.isConnected)
      bagOpener.current.focus({ preventScroll: true });
    bagOpener.current = null;
  }

  function closeBagFromBackdrop(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeBag();
  }
  function closeDialogs(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        event.currentTarget.close();
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
        <Link
          href="/"
          className="wordmark brand-logo"
          aria-label="Wok and Chop home"
        >
          <span className="brand-logo-frame brand-logo-box" aria-hidden="true">
            <img
              src="/images/brand/wok-and-chop-box.png"
              width="2000"
              height="2000"
              alt=""
            />
          </span>
          <span
            className="brand-logo-frame brand-logo-horizontal"
            aria-hidden="true"
          >
            <img
              src="/images/brand/wok-and-chop-horizontal.png"
              width="2908"
              height="968"
              alt=""
            />
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/" aria-current={page === "home" ? "page" : undefined}>
            Home
          </Link>
          <Link
            href="/our-story/"
            aria-current={page === "story" ? "page" : undefined}
          >
            Our story
          </Link>
          <Link
            href="/menu/"
            aria-current={page === "menu" ? "page" : undefined}
          >
            Menu
          </Link>
          <Link
            href="/delivery/"
            aria-current={page === "delivery" ? "page" : undefined}
          >
            Delivery
          </Link>
          <Link
            href="/contact/"
            aria-current={page === "visit" ? "page" : undefined}
          >
            Contact us
          </Link>
        </nav>
        <div className="header-actions">
          <Link
            className="account-link"
            href="/account/"
            aria-current={page === "account" ? "page" : undefined}
          >
            {customer ? "My account" : "Sign in"}
          </Link>
          <button
            className="bag-button"
            onClick={openBag}
            aria-label={`Your bag, ${count} items`}
          >
            <Bag count={count} />
          </button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Link href="/menu/" aria-current={page === "menu" ? "page" : undefined}>
          Menu
        </Link>
        <Link
          href="/our-story/"
          aria-current={page === "story" ? "page" : undefined}
        >
          Our story
        </Link>
        <Link
          href="/contact/"
          aria-current={page === "visit" ? "page" : undefined}
        >
          Contact us
        </Link>
        <Link
          href="/delivery/"
          aria-current={page === "delivery" ? "page" : undefined}
        >
          Delivery
        </Link>
      </nav>
      <main id="main" className={`page-${page}`}>
        {page === "home" && <HomeContent />}

        {page === "menu" && (
          <MenuContent
            items={menuItems}
            onChoose={openItem}
            lines={priced}
            subtotal={subtotal}
            onBag={openBag}
          />
        )}

        {page === "home" && (
          <section
            className="home-story has-ink-art"
            aria-labelledby="home-story-title"
          >
            <div className="home-story-heading">
              <p className="home-story-eyebrow">Our story</p>
              <h2 id="home-story-title">
                Chinese roots.
                <br />
                <strong>Hakka soul.</strong>
              </h2>
            </div>
            <figure className="home-story-ink" aria-hidden="true">
              <img
                src="/images/art/wok-kitchen.webp"
                alt=""
                width="1200"
                height="800"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="home-story-copy">
              <p>
                A Halal Hakka Chinese kitchen, right here in Kanata.
                <br />
                Good food starts with a good appetite.
              </p>
              <Link className="text-link" href="/our-story/">
                Meet Wok & Chop <Arrow />
              </Link>
            </div>
          </section>
        )}
        {page === "home" && <FoodStories />}
        {page === "home" && <HomeExtras />}
        {page === "home" && <FooterFeast />}
        {page === "story" && <StoryContent />}
        {page === "visit" && <VisitContent />}
        {page === "account" && <AccountContent />}
        {page === "delivery" && <DeliveryContent />}
        {page === "menu" && (
          <section className="menu-help">
            <h2>A few things before you order.</h2>
            <details>
              <summary>Can I order without an account?</summary>
              <p>
                Yes. Guest checkout is the default. Your current bag stays in
                this browser, and you can submit a test delivery without an
                account.
              </p>
            </details>
            <details>
              <summary>Do you offer delivery?</summary>
              <p>
                Try the home delivery checkout with a test address, then follow
                the order’s progress.
              </p>
            </details>
            <details>
              <summary>What about allergies?</summary>
              <p>
                Please speak directly to the restaurant before ordering.
                Preparation notes cannot guarantee an allergen-free meal.
              </p>
            </details>
          </section>
        )}
      </main>
      <footer className="site-footer has-ink-art">
        <img
          className="footer-plum-art"
          src="/images/art/plum-branch.webp"
          alt=""
          aria-hidden="true"
          width="900"
          height="300"
          loading="lazy"
          decoding="async"
        />
        <div className="footer-top">
          <Link
            href="/"
            className="footer-name brand-logo-footer"
            aria-label="Wok and Chop home"
          >
            <img
              src="/images/brand/wok-and-chop-horizontal-white.png"
              width="900"
              height="300"
              alt=""
              loading="lazy"
            />
          </Link>
          <div className="footer-page-links">
            <Link href="/menu/">Menu</Link>
            <Link href="/delivery/#track">Track a delivery</Link>
            <Link href="/our-story/">Our story</Link>
            <Link href="/contact/">Contact us</Link>
            <Link href="/account/">Your account</Link>
          </div>
          <p>
            790 Kanata Ave, Unit M2A
            <br />
            Kanata, Ontario
            <br />
            Fresh • Flavorful • 100% Halal
          </p>
        </div>
        <div className="footer-bottom">
          <span>Kanata, Ontario · Hakka Chinese</span>
          <div>
            <Link href="/staff/">Staff console</Link>
            <Link href="/kitchen/">Kitchen display</Link>
            <Link href="/privacy/">Privacy</Link>
          </div>
          <a href="#">Back to top ↑</a>
        </div>
      </footer>
      {count > 0 && page !== "delivery" && (
        <button className="mobile-bag" onClick={openBag}>
          <Bag count={count} />
          <strong>{formatMoney(subtotal)}</strong>
        </button>
      )}
      <div className={`toast ${message ? "visible" : ""}`} role="status">
        {message}
      </div>

      <dialog
        ref={itemDialog}
        className="item-dialog"
        aria-labelledby="item-dialog-title"
        onClick={closeDialogs}
      >
        <button
          className="dialog-close"
          aria-label="Close dish details"
          onClick={() => itemDialog.current?.close()}
        >
          ×
        </button>
        {selected && (
          <form onSubmit={addItem}>
            {selected.image && (
              <img
                className={`dialog-food-photo ${selected.imagePresentation === "cutout" ? "is-cutout" : ""}`}
                src={selected.image}
                alt={selected.name}
                width="600"
                height="280"
              />
            )}
            <div className="dialog-content">
              <p className="sample-label">{formatMoney(selected.priceCents)}</p>
              <h2 id="item-dialog-title">{selected.name}</h2>
              <p>{selected.description}</p>
              {selected.modifierGroups?.map((group) => (
                <fieldset key={group.id}>
                  <legend>
                    {group.name} <span>Choose {group.min} · Required</span>
                  </legend>
                  <div className="spice-options">
                    {group.options.map((option) => (
                      <label
                        key={option.id}
                        className={
                          modifiers.includes(option.id) ? "selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name={group.id}
                          value={option.id}
                          required
                          checked={modifiers.includes(option.id)}
                          onChange={() =>
                            setModifiers((current) => [
                              ...current.filter(
                                (id) => !group.options.some((o) => o.id === id),
                              ),
                              option.id,
                            ])
                          }
                        />
                        {option.name}
                        {option.priceCents > 0 &&
                          ` +${formatMoney(option.priceCents)}`}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <label className="field-label">
                A note for the kitchen <span>Optional</span>
                <textarea
                  maxLength={240}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Any preparation preferences?"
                  rows={2}
                />
              </label>
              <p className="field-hint">
                {note.length}/240 · For allergy questions, please speak to the
                restaurant. Your note does not guarantee an allergen-free meal.
              </p>
              {formError && (
                <p role="alert" className="form-error">
                  {formError}
                </p>
              )}
              <div className="add-to-bag">
                <div className="quantity-control">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={quantity === 1}
                    onClick={() => setQuantity(quantity - 1)}
                  >
                    −
                  </button>
                  <output>{quantity}</output>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={quantity === 20}
                    onClick={() => setQuantity(quantity + 1)}
                  >
                    +
                  </button>
                </div>
                <button type="submit" className="primary-button">
                  Add to bag <span>{formatMoney(selectedTotal)}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </dialog>

      <dialog
        ref={bagDialog}
        className="bag-dialog wc-bag-drawer"
        aria-labelledby="bag-title"
        aria-describedby="bag-availability"
        onClick={closeBagFromBackdrop}
        onCancel={(event) => {
          event.preventDefault();
          closeBag();
        }}
        onClose={handleBagClosed}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "transform" &&
            event.currentTarget.dataset.state === "closing"
          )
            finishBagClose();
        }}
      >
        <header className="wc-bag-heading">
          <div>
            <h2 id="bag-title" ref={bagTitle} tabIndex={-1}>
              Your bag
            </h2>
            <span>
              {count} {count === 1 ? "item" : "items"}
            </span>
          </div>
          <button
            type="button"
            className="wc-bag-close"
            aria-label="Close bag"
            onClick={closeBag}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m5 5 10 10M15 5 5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <p className="wc-bag-availability" id="bag-availability">
          Local delivery checkout. Test orders are saved without collecting
          payment.
        </p>
        <div className="wc-bag-content" ref={bagBody}>
          {!cart.length ? (
            <div className="wc-bag-empty">
              <svg
                width="44"
                height="48"
                viewBox="0 0 44 48"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M7 14h30l2 29H5L7 14ZM15 16V10a7 7 0 0 1 14 0v6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
              <h3>Your bag is empty</h3>
              <p>Add a dish from the menu to get started.</p>
              <Link className="wc-bag-primary" href="/menu/" onClick={closeBag}>
                Explore the menu <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : (
            <>
              <div className="wc-bag-location">
                <svg
                  width="19"
                  height="23"
                  viewBox="0 0 20 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M17 9c0 5-7 12-7 12S3 14 3 9a7 7 0 1 1 14 0Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="10"
                    cy="9"
                    r="2.3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                <div>
                  <strong>Home delivery</strong>
                  <span>Enter your address at guest checkout</span>
                </div>
              </div>
              <ul className="wc-bag-lines" aria-label="Items in your bag">
                {priced.map((line) => {
                  const item = menuItems.find(
                    (entry) => entry.id === line.itemId,
                  );
                  return (
                    <li
                      className={`wc-bag-line${item?.image ? "" : " has-no-image"}`}
                      key={line.key}
                    >
                      {item?.image && (
                        <img
                          className={`wc-bag-thumbnail${item.imagePresentation === "cutout" ? " is-cutout" : ""}`}
                          src={item.image}
                          alt=""
                          width={72}
                          height={72}
                        />
                      )}
                      <div className="wc-bag-line-content">
                        <div className="wc-bag-line-heading">
                          <h3>{line.name}</h3>
                          <strong>{formatMoney(line.lineTotalCents)}</strong>
                        </div>
                        {line.modifiers.length > 0 && (
                          <p className="wc-bag-modifiers">
                            {line.modifiers
                              .map(
                                (modifier) =>
                                  `${modifier.name}${modifier.priceCents > 0 ? ` (+${formatMoney(modifier.priceCents)})` : ""}`,
                              )
                              .join(" · ")}
                          </p>
                        )}
                        {line.note && (
                          <p className="wc-bag-note">Note: {line.note}</p>
                        )}
                        <div className="wc-bag-line-actions">
                          <div
                            className="wc-bag-quantity"
                            role="group"
                            aria-label={`${line.name} quantity`}
                          >
                            <button
                              type="button"
                              aria-label={`Decrease ${line.name} quantity`}
                              onClick={() => adjust(line.key, -1)}
                            >
                              −
                            </button>
                            <output aria-label={`${line.name} quantity`}>
                              {line.quantity}
                            </output>
                            <button
                              type="button"
                              aria-label={`Increase ${line.name} quantity`}
                              disabled={line.quantity >= 20}
                              onClick={() => adjust(line.key, 1)}
                            >
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            className="wc-bag-remove"
                            aria-label={`Remove ${line.name}`}
                            onClick={() => removeBagItem(line.key, line.name)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="wc-bag-promo-section">
                <details className="wc-bag-promo" ref={bagPromo}>
                  <summary>
                    Add a promo code <span aria-hidden="true">+</span>
                  </summary>
                  <form onSubmit={applyPromo}>
                    <label htmlFor="promo-code" className="wc-bag-sr">
                      Promo code
                    </label>
                    <div className="wc-bag-promo-input">
                      <input
                        id="promo-code"
                        value={promoInput}
                        onChange={(event) => {
                          setPromoInput(event.target.value);
                          setPromoError("");
                        }}
                        placeholder="Enter code"
                        maxLength={30}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        aria-invalid={Boolean(promoError)}
                        aria-describedby={
                          promoError ? "bag-promo-error" : "bag-promo-help"
                        }
                      />
                      <button type="submit" disabled={!promoInput.trim()}>
                        Apply
                      </button>
                    </div>
                    <p id="bag-promo-help">
                      WOK10: 10% off food orders of $20+, up to $15. One code
                      per bag.
                    </p>
                    {promoError && (
                      <p
                        id="bag-promo-error"
                        className="wc-bag-error"
                        role="alert"
                      >
                        {promoError}
                      </p>
                    )}
                  </form>
                </details>
                {promoCode && (
                  <div className="wc-bag-applied-code">
                    <div>
                      <strong>{promoCode}</strong>
                      <span>{promoNotice || "Code applied"}</span>
                    </div>
                    <button
                      type="button"
                      className="wc-bag-remove"
                      aria-label="Remove promo code"
                      onClick={() => {
                        setPromoCode("");
                        setPromoInput("");
                        setPromoError("");
                        setBagAnnouncement("Promo code removed.");
                        bagPromo.current?.querySelector("summary")?.focus();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {cart.length > 0 && (
          <footer className="wc-bag-footer">
            <dl className="wc-bag-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(subtotal)}</dd>
              </div>
              {discount > 0 && (
                <div className="wc-bag-discount">
                  <dt>Discount · {promoCode}</dt>
                  <dd>−{formatMoney(discount)}</dd>
                </div>
              )}
              <div className="wc-bag-total">
                <dt>Food total</dt>
                <dd>
                  {formatMoney(subtotal - discount)} <span>CAD</span>
                </dd>
              </div>
            </dl>
            <p className="wc-bag-tax-note">
              Review the server-priced food total at checkout.
            </p>
            <Link
              className="wc-bag-primary"
              href="/delivery/"
              onClick={() => {
                saveDeliverySession(deliveryPromoKey, promoCode);
                closeBag();
              }}
            >
              Continue to delivery <span aria-hidden="true">→</span>
            </Link>
            <p className="wc-bag-guest">
              {customer
                ? `Signed in as ${customer.name}.`
                : "Guest checkout available."}{" "}
              <Link href="/delivery/#track" onClick={closeBag}>
                Track a delivery
              </Link>
            </p>
          </footer>
        )}
        <p
          className="wc-bag-sr"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {bagAnnouncement}
        </p>
      </dialog>
    </>
  );
}
