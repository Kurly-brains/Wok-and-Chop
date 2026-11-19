import Link from "next/link";
import InkInscription from "./ink-inscription";
import "../styles/contact.css";

// Public contact details verified against https://wokandchop.ca/contact/.
const directionsUrl =
  "https://www.google.com/maps/dir/?api=1&destination=790%20Kanata%20Ave%20Unit%20M2A%2C%20Kanata%20ON";

export function VisitContent() {
  return (
    <section className="wc-contact" aria-labelledby="contact-title">
      <header className="wc-contact-heading">
        <h1 id="contact-title">Contact us.</h1>
        <p>Find our Hakka kitchen in Kanata Entertainment Centrum.</p>
      </header>

      <div className="wc-contact-layout">
        <div className="wc-contact-details">
          <dl>
            <div className="wc-contact-detail">
              <dt>Call the restaurant</dt>
              <dd>
                <a href="tel:+16135911111">(613) 591-1111</a>
              </dd>
            </div>
            <div className="wc-contact-detail">
              <dt>Email us</dt>
              <dd>
                <a href="mailto:info@wokandchop.ca">info@wokandchop.ca</a>
              </dd>
            </div>
            <div className="wc-contact-detail wc-contact-location">
              <dt>Find us in Kanata</dt>
              <dd>
                <address>
                  <strong>Wok &amp; Chop</strong>
                  790 Kanata Avenue, Unit M2A
                  <br />
                  Kanata, Ontario
                </address>
                <a
                  className="wc-contact-directions"
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get directions in Google Maps{" "}
                  <span aria-hidden="true">↗</span>
                </a>
              </dd>
            </div>
          </dl>
        </div>
        <figure className="wc-contact-art">
          <InkInscription stamp="茶">請坐</InkInscription>
          <img
            src="/images/art/kanata-table.webp"
            width={1200}
            height={800}
            alt="Ink illustration of a teapot, tea cups and chopsticks"
            fetchPriority="high"
          />
        </figure>
      </div>

      <div className="wc-contact-notes">
        <section aria-labelledby="contact-visit-title">
          <h2 id="contact-visit-title">Before you visit.</h2>
          <p>
            Call the restaurant for today’s hours and any questions about
            allergies or dietary needs.
          </p>
        </section>
        <section aria-labelledby="contact-ordering-title">
          <h2 id="contact-ordering-title">Home delivery</h2>
          <p>
            Explore the guest checkout and delivery tracker with a test order.
          </p>
          <Link href="/delivery/">
            Home delivery <span aria-hidden="true">↗</span>
          </Link>
        </section>
      </div>
    </section>
  );
}

export default VisitContent;
