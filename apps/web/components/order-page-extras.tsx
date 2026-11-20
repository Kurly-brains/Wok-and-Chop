import Link from "next/link";
import { formatMoney, lunchCategories, type MenuCatalogItem } from "@wok/domain";
import { pickupTrackingUrl } from "../lib/ordering";
import { featuredDishes } from "../lib/featured-dishes";
import InkInscription from "./ink-inscription";
import "../styles/order-page-extras.css";

const directionsUrl =
  "https://www.google.com/maps/dir/?api=1&destination=790%20Kanata%20Ave%20Unit%20M2A%2C%20Kanata%20ON";

export default function OrderPageExtras({ items }: { items: readonly MenuCatalogItem[] }) {
  const dishes = featuredDishes(items).slice(0, 3);

  return (
    <>
      {dishes.length > 0 && (
        <section className="order-page-menu" aria-labelledby="order-page-menu-title">
          <div className="order-page-extra-inner">
            <header className="order-page-menu-heading">
              <InkInscription>美食</InkInscription>
              <h2 id="order-page-menu-title">From the lunch menu</h2>
              <Link className="order-page-text-link" href="/menu/">
                Browse all dishes <span aria-hidden="true">↗</span>
              </Link>
            </header>
            <ul className="order-page-menu-list">
              {dishes.map(dish => {
                const hasCategory = lunchCategories.some(category => category.id === dish.categoryId);
                const href = hasCategory ? `/menu/?category=${dish.categoryId}` : "/menu/";

                return (
                  <li key={dish.id}>
                    <Link className="order-page-dish" href={href} data-image={dish.imagePresentation ?? "photo"}>
                      <span className="order-page-dish-photo">
                        {dish.image ? <img src={dish.image} alt="" loading="lazy" decoding="async" /> : <span className="order-page-dish-no-photo" aria-hidden="true">客家</span>}
                      </span>
                      <span className="order-page-dish-label">
                        <span className="order-page-dish-name">{dish.name}</span>
                        <span className="order-page-dish-price">
                          {formatMoney(dish.priceCents)}
                          <span aria-hidden="true">↗</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
      <section className="order-page-visit" aria-labelledby="order-page-visit-title">
        <div className="order-page-extra-inner order-page-visit-layout">
          <img
            className="order-page-visit-art"
            src="/images/art/kanata-table.webp"
            alt=""
            width={1200}
            height={800}
            loading="lazy"
            decoding="async"
          />
          <div className="order-page-visit-panel">
            <InkInscription>自取</InkInscription>
            <h2 id="order-page-visit-title">Pick up in Kanata.</h2>
            <address>790 Kanata Ave, Unit M2A<br />Kanata, ON</address>
            <div className="order-page-visit-links">
              <a className="order-page-text-link" href={directionsUrl}>
                Get directions <span aria-hidden="true">↗</span>
              </a>
              <Link className="order-page-text-link" href={pickupTrackingUrl}>
                Track a direct pickup <span aria-hidden="true">→</span>
              </Link>
              <a className="order-page-text-link" href="#book-a-table">
                Book a table <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
