import Link from "next/link";
import type { MenuCatalogItem } from "@wok/domain";
import InkInscription from "./ink-inscription";
import OrderChoices from "./order-choices";
import RoundTable from "./round-table";
import { featuredDishes } from "../lib/featured-dishes";
import "../styles/layered-home.css";
export default function HomeContent({ items }: { items: readonly MenuCatalogItem[] }) {
  const picks = featuredDishes(items).slice(0, 3);
  const tones = ["ochre", "jade", "red"];
  return (
    <>
      <section
        className="layer-hero has-round-table"
        aria-labelledby="hero-title"
      >
        <p className="layer-hero-kicker inscription-line">
          <InkInscription>開飯</InkInscription> Hakka Chinese. Kanata at heart.
        </p>
        <h1 id="hero-title">
          Big wok.
          <br />
          <strong>Bold flavour.</strong>
        </h1>
        <RoundTable items={items} />
        <div className="layer-hero-invitation">
          <p>
            A little heat.
            <br />A generous helping.
            <br />
            Pull up a chair.
          </p>
          <a href="#order" className="primary-button">
            Order online <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="hero-halal">
          <span>Fresh.</span>
          <span>Flavorful.</span>
          <strong>100% Halal.</strong>
        </div>
      </section>
      <OrderChoices items={items} embedded />
      {picks.length > 0 && <section className="food-showcase" aria-labelledby="showcase-title">
        <div className="showcase-heading">
          <p className="handwritten">Something for the whole table.</p>
          <h2 id="showcase-title">
            Find your kind of <strong>flavour.</strong>
          </h2>
          <p>Browse the menu, one craving at a time.</p>
        </div>
        <div className="food-stage-list">
          {picks.map((pick, index) => (
            <article key={pick.id} className={`food-stage ${tones[index]}`}>
              <div className="food-stage-panel">
                <span>{pick.name}</span>
              </div>
              <Link
                className="food-stage-image"
                href={`/menu/?category=${pick.categoryId}`}
                aria-label={`Explore ${pick.name}`}
              >
                {pick.image ? <img
                  src={pick.image}
                  alt=""
                  width="850"
                  height="850"
                  loading="lazy"
                /> : <span className="food-stage-no-photo" aria-hidden="true">客家</span>}
              </Link>
              <div className="food-stage-caption">
                <Link className="text-link" href={`/menu/?category=${pick.categoryId}`}>
                  View {pick.name}{" "}
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
        <div className="showcase-bottom">
          <Link className="text-link" href="/menu/">
            Explore the full menu <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>}
    </>
  );
}
