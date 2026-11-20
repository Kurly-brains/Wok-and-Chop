import Link from "next/link";
import { lunchMenuDetails, type MenuCatalogItem } from "@wok/domain";
import { catalogDish, featuredDishes } from "../lib/featured-dishes";
import InkInscription from "./ink-inscription";
import "../styles/footer-feast.css";

export default function FooterFeast({ items }: { items: readonly MenuCatalogItem[] }) {
  const noodles = catalogDish(items, "lunch-chicken-chow-mein");
  const bowl = noodles?.imagePresentation === "cutout" && noodles.image
    ? noodles.image
    : featuredDishes(items).find(item => item.imagePresentation === "cutout" && item.image)?.image;
  return (
    <section className={`footer-feast${bowl ? "" : " footer-feast--copy-only"}`} aria-labelledby="footer-feast-title">
      <div className="footer-feast-inner">
        {bowl && <div className="footer-feast-art" aria-hidden="true">
          <img
            className="footer-feast-bowl"
            src={bowl}
            width="1200"
            height="1200"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <img
            className="footer-feast-chopsticks"
            src="/images/chopsticks-cutout.webp"
            width="118"
            height="1100"
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>}
        <div className="footer-feast-copy">
          <div className="footer-feast-heading">
            <h2 id="footer-feast-title">Lunch in Kanata.</h2>
            <InkInscription stamp="客家">請坐</InkInscription>
          </div>
          <p className="footer-feast-hours">
            <time dateTime={lunchMenuDetails.startTime}>12 p.m.</time>–
            <time dateTime={lunchMenuDetails.endTime}>3 p.m.</time>
            {lunchMenuDetails.holidaysExcluded && " · Holidays excluded"}
          </p>
          <p>
            Each lunch entrée comes with jasmine rice, a vegetable spring roll
            and your choice of soup of the day or pop.
          </p>
          <Link href="/menu/" className="footer-feast-link">
            <span>View the lunch menu</span>
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
