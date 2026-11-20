import Link from "next/link";
import type { MenuCatalogItem } from "@wok/domain";
import { pickupCheckoutUrl, uberEatsUrl } from "../lib/ordering";
import DeliveryScooter from "./delivery-scooter";
import InkInscription from "./ink-inscription";
import SlidingDisclosure from "./sliding-disclosure";
import { featuredDishes } from "../lib/featured-dishes";
import "../styles/order-choices.css";

export default function OrderChoices({ items, embedded = false }: { items: readonly MenuCatalogItem[]; embedded?: boolean }) {
  const Heading = embedded ? "h2" : "h1";
  const pickupArt = featuredDishes(items).find(item => item.image && item.imagePresentation === "cutout")?.image;

  return (
    <section id="order" className="wc-order" aria-labelledby="order-title">
      <div className="wc-order-inner">
        <header className="wc-order-heading">
          <InkInscription>點餐</InkInscription>
          <Heading id="order-title">Order online.</Heading>
          <Link className="wc-order-menu-link" href="/menu/">View menu <span aria-hidden="true">↗</span></Link>
        </header>
        <div className="wc-order-grid">
          <SlidingDisclosure
            triggerClassName="wc-order-card wc-order-card--pickup"
            trigger={(
              <>
                {pickupArt && <img className="wc-order-art wc-order-dish" src={pickupArt} width={850} height={850} alt="" loading="lazy" decoding="async" />}
                <span className="wc-order-card-copy">
                  <span className="wc-order-card-ink" lang="zh-Hant" aria-hidden="true">自取</span>
                  <strong>Pickup</strong>
                  <span className="wc-order-card-description">Collect your order in Kanata.</span>
                  <span className="wc-order-card-action">Choose pickup <span aria-hidden="true" /></span>
                </span>
              </>
            )}
          >
            <div className="wc-order-framed-panel wc-order-pickup-options">
              <Link className="wc-order-method wc-order-method--direct" href={pickupCheckoutUrl}>
                Order with Wok &amp; Chop <span aria-hidden="true">→</span>
              </Link>
              <a className="wc-order-method" href={uberEatsUrl}>
                <img src="/images/brand/uber-eats-square.png" alt="" width={32} height={32} />
                <span>Pickup with Uber Eats</span> <span aria-hidden="true">↗</span>
              </a>
              <p>Select Pickup on Uber Eats to collect your order.</p>
            </div>
          </SlidingDisclosure>

          <a className="wc-order-card wc-order-card--delivery" href={uberEatsUrl}>
            <div className="wc-order-scooter" aria-hidden="true">
              <DeliveryScooter />
            </div>
            <span className="wc-order-card-copy">
              <span className="wc-order-card-ink" lang="zh-Hant" aria-hidden="true">外送</span>
              <strong>Delivery</strong>
              <span className="wc-order-card-description">Home delivery through Uber Eats.</span>
              <span className="wc-order-partner">
                <img src="/images/brand/uber-eats-horizontal.svg" width={105} height={17} alt="Uber Eats" />
                <span aria-hidden="true">↗</span>
              </span>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
