import Link from "next/link";
import GuestReviews from "./guest-reviews";
import InkInscription from "./ink-inscription";
import "../styles/home-extras.css";

const directionsUrl =
  "https://www.google.com/maps/dir/?api=1&destination=790%20Kanata%20Ave%20Unit%20M2A%2C%20Kanata%20ON";

export default function HomeExtras() {
  return (
    <div className="wc-home-extras">
      <section className="wc-home-pickup" aria-labelledby="home-pickup-title">
        <div className="wc-home-pickup-composition">
          <figure className="wc-home-kitchen-art">
            <InkInscription stamp="客家">家常菜</InkInscription>
            <img
              src="/images/chinese-kitchen-art.webp"
              alt="Chinese kitchen brush illustration"
              width={1200}
              height={1200}
              loading="lazy"
            />
          </figure>
          <div className="wc-home-pickup-copy">
            <h2 id="home-pickup-title">
              Your table.<br />
              <strong>Your way.</strong>
            </h2>
            <p className="wc-home-pickup-intro">
              Hakka Chinese favourites, delivered to your door.
            </p>
            <ol className="wc-home-pickup-list">
              <li><span aria-hidden="true">01</span><div><h3>Find your favourites.</h3><p>Choose your dishes and make them yours.</p></div></li>
              <li><span aria-hidden="true">02</span><div><h3>Add your address.</h3><p>Review your details and food total before placing the order.</p></div></li>
              <li><span aria-hidden="true">03</span><div><h3>Follow your delivery.</h3><p>Use your private tracking code to see when it’s on its way.</p></div></li>
            </ol>
            <p className="wc-home-pickup-status">
              Guest checkout is available for local test deliveries.
            </p>
            <Link className="wc-home-editorial-link" href="/menu/">
              Explore the menu <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </section>

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
