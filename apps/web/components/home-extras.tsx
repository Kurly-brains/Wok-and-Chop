import Link from "next/link";
import GuestReviews from "./guest-reviews";
import "../styles/home-extras.css";

const directionsUrl =
  "https://www.google.com/maps/dir/?api=1&destination=790%20Kanata%20Ave%20Unit%20M2A%2C%20Kanata%20ON";

export default function HomeExtras() {
  return (
    <div className="wc-home-extras">
      <GuestReviews />

      <section className="wc-home-location" aria-labelledby="home-location-title">
        <div className="wc-home-location-inner">
          <h2 id="home-location-title">
            Good food,<br />
            <strong>around the corner.</strong>
          </h2>
          <div className="wc-home-location-details">
            <p>Wok &amp; Chop · Kanata</p>
            <address>790 Kanata Ave, Unit M2A<br />Kanata, ON</address>
            <div className="wc-home-location-links">
              <Link className="wc-home-editorial-link" href="/contact/">
                Contact us <span aria-hidden="true">↗</span>
              </Link>
              <a className="wc-home-editorial-link" href={directionsUrl} target="_blank" rel="noopener noreferrer">
                Get directions <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
