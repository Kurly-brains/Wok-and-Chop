"use client";

import { useState } from "react";
import Link from "next/link";
import InkInscription from "./ink-inscription";
import {
  formatMoney,
  lunchCategories,
  lunchMenuDetails,
  type MenuItem,
  type PricedLine,
} from "@wok/domain";
import { useRequestedCategory } from "../lib/use-requested-category";
import { canAddDish, dishOptionGroups } from "../lib/dish-options";
import { searchLunchMenu } from "../lib/menu-search";
import { pickupCheckoutUrl, uberEatsUrl } from "../lib/ordering";
import "../styles/menu.css";

type Props = {
  items: readonly MenuItem[];
  onView: (item: MenuItem) => void;
  onAdd: (item: MenuItem) => void;
  lines: (PricedLine & { key: string })[];
  subtotal: number;
  onBag: () => void;
};

const legacyCategories: Record<string, string> = {
  noodles: "lunch-rice-noodles",
  rice: "lunch-rice-noodles",
  wok: "lunch-chicken",
  vegetarian: "lunch-vegetarian",
  starters: "all",
};

function DishCard({
  item,
  quantity,
  onView,
  onAdd,
}: {
  item: MenuItem;
  quantity: number;
  onView: Props["onView"];
  onAdd: Props["onAdd"];
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasImage = Boolean(item.image && failedImage !== item.image);
  const category = lunchCategories.find(
    (entry) => entry.id === item.categoryId,
  );
  const styles = item.modifierGroups?.find(
    (group) => group.id === "lunch-style",
  );
  const preparations = item.modifierGroups
    ?.find((group) => group.id === "lunch-preparation")
    ?.options.filter((option) => option.available !== false);
  const hasOptions = dishOptionGroups(item).length > 0;
  const orderable = canAddDish(item);
  const addLabel = quantity > 0 ? "Add more" : "Add";
  return (
    <article
      className={`menu-dish-card${quantity > 0 ? " is-added" : ""}`}
      aria-labelledby={`dish-title-${item.id}`}
      data-item-id={item.id}
    >
      <button
        className={`menu-dish-photo is-${item.imagePresentation ?? "photo"}`}
        type="button"
        onClick={() => onView(item)}
        aria-label={`View ${item.name} details`}
        aria-haspopup="dialog"
      >
        {hasImage ? (
          <img
            src={item.image}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => setFailedImage(item.image ?? "")}
          />
        ) : (
          <span
            className="menu-dish-no-photo"
            role="img"
            aria-label={`Photo not available for ${item.name}`}
          >
            <svg viewBox="0 0 100 80" fill="none" aria-hidden="true">
              <path
                d="M16 34h68c-2 23-14 34-34 34S18 57 16 34Z"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M33 71h34M38 22 78 5M42 29 83 14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>WOK &amp; CHOP</span>
            <small>{category?.name}</small>
          </span>
        )}
        {quantity > 0 && (
          <span className="menu-dish-added">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="m4 10 4 4 8-8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {quantity} in your bag
          </span>
        )}
      </button>
      <div className="menu-dish-copy">
        <h2 id={`dish-title-${item.id}`}>{item.name}</h2>
        {item.description && (
          <p className="menu-dish-description">{item.description}</p>
        )}
        <p className="menu-dish-flags">
          {item.vegetarian && <span>Vegetarian</span>}
          {item.heatLevel ? (
            <span>
              {item.heatLevel === 2 ? "Extra spicy" : "Mild–medium heat"}
            </span>
          ) : null}
          {item.containsPeanuts && <span>Contains peanuts</span>}
          {preparations?.length ? (
            <span>{preparations.map((option) => option.name).join(" / ")}</span>
          ) : null}
          {styles && (
            <span>
              {styles.options
                .filter((option) => option.available !== false)
                .map((option) => option.name)
                .join(" / ")}
            </span>
          )}
        </p>
        <div className="menu-dish-actions">
          <strong>{formatMoney(item.priceCents)}</strong>
          <button
            type="button"
            onClick={() => onAdd(item)}
            disabled={!orderable}
            aria-haspopup={hasOptions && orderable ? "dialog" : undefined}
            aria-label={
              !orderable
                ? `${item.name} is unavailable`
                : hasOptions
                  ? `Options for ${item.name}`
                  : `${addLabel} ${item.name} to bag`
            }
          >
            {orderable ? (hasOptions ? "Options" : addLabel) : "Unavailable"}
            {orderable && (
              <span aria-hidden="true">{hasOptions ? "›" : "+"}</span>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function MenuContent({
  items,
  onView,
  onAdd,
  lines,
  subtotal,
  onBag,
}: Props) {
  const requested = useRequestedCategory();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const requestedActive = legacyCategories[requested] ?? requested;
  const active = selected ?? requestedActive;
  const visible = searchLunchMenu(items, active, query);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const quantities = new Map<string, number>();
  for (const line of lines) {
    quantities.set(
      line.itemId,
      (quantities.get(line.itemId) ?? 0) + line.quantity,
    );
  }
  return (
    <section className="restaurant-menu" aria-labelledby="menu-title">
      <header className="menu-photo-banner">
        <img src="/images/hakka-table.jpg" alt="" fetchPriority="high" />
        <div>
          <p>Wok &amp; Chop</p>
          <h1 id="menu-title">
            Menu <InkInscription>菜單</InkInscription>
          </h1>
          <span>Hakka Chinese. Made for your table.</span>
        </div>
      </header>
      <div className="menu-page-content">
        <section className="menu-order-guide" aria-label="Pickup and delivery">
          <div>
            <h2>Pickup</h2>
            <p>Choose dishes here and collect your order at Wok &amp; Chop.</p>
            {count ? (
              <Link
                className="wc-order-method wc-order-method--direct"
                href={pickupCheckoutUrl}
              >
                Continue to pickup <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <a
                className="wc-order-method wc-order-method--direct"
                href="#menu-choices"
              >
                Choose dishes for pickup <span aria-hidden="true">↓</span>
              </a>
            )}
          </div>
          <div>
            <h2>Home delivery</h2>
            <p>Order through Uber Eats for delivery to your door.</p>
            <a className="wc-order-method" href={uberEatsUrl}>
              <img
                className="menu-order-uber"
                src="/images/brand/uber-eats-horizontal.svg"
                alt="Uber Eats"
                width={105}
                height={17}
              />
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
        <div
          id="menu-choices"
          className="menu-category-tabs"
          role="group"
          aria-label="Lunch categories"
        >
          <button
            aria-pressed={active === "all"}
            onClick={() => setSelected("all")}
          >
            All dishes
          </button>
          {lunchCategories.map((category) => (
            <button
              key={category.id}
              aria-pressed={active === category.id}
              onClick={() => setSelected(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
        <div className="menu-lunch-details">
          <div>
            <h2>A little time for lunch.</h2>
            <p className="menu-lunch-hours">
              12:00 PM – 3:00 PM · Holidays excluded
            </p>
          </div>
          <p>
            Check each dish for included sides and available options. Where
            offered, fried rice adds{" "}
            {formatMoney(lunchMenuDetails.friedRiceUpgradeCents)} and dry
            preparation adds {formatMoney(lunchMenuDetails.dryPreparationCents)}
            .
          </p>
        </div>
        <div className="menu-grid-toolbar">
          <label className="menu-grid-search">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle
                cx="8"
                cy="8"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="m12 12 5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search dishes, spice or ingredients"
              aria-label="Search lunch menu"
              aria-controls="menu-search-results"
            />
          </label>
          <p className="menu-result-count" aria-live="polite">
            {visible.length} {visible.length === 1 ? "dish" : "dishes"} · CAD
          </p>
          <button className="menu-bag-summary" onClick={onBag}>
            Your bag ({count}) <strong>{formatMoney(subtotal)}</strong>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="menu-dish-grid" id="menu-search-results">
          {visible.map((item) => (
            <DishCard
              key={item.id}
              item={item}
              quantity={quantities.get(item.id) ?? 0}
              onView={onView}
              onAdd={onAdd}
            />
          ))}
        </div>
        {visible.length === 0 && (
          <div className="menu-grid-empty" role="status">
            <h2>No dishes found.</h2>
            <p>Try a dish, an ingredient or a word like “spicy”.</p>
            <button
              onClick={() => {
                setQuery("");
                setSelected("all");
              }}
            >
              Show all dishes ↗
            </button>
          </div>
        )}
        <footer className="menu-grid-notes">
          <p>
            Please tell our team about any food allergies or dietary
            restrictions. We cannot guarantee a completely allergen-free
            environment.
          </p>
          <p>
            Groups of 7 or more: a 15% gratuity will be automatically added to
            the bill.
          </p>
        </footer>
      </div>
    </section>
  );
}
