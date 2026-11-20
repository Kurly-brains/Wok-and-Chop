import Link from "next/link";
import { CookieSettingsButton } from "./cookie-settings";
import InkInscription from "./ink-inscription";
import "../styles/site-footer.css";

export default function SiteFooter({
  hasMobileBag = false,
}: {
  hasMobileBag?: boolean;
}) {
  return (
    <footer
      className={`site-footer wc-site-footer${hasMobileBag ? " wc-site-footer--with-bag" : ""}`}
    >
      <div className="wc-footer-art" aria-hidden="true">
        <img
          className="wc-footer-blossom"
          src="/images/art/plum-branch.webp"
          alt=""
          width={900}
          height={300}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="wc-footer-inner">
        <div className="wc-footer-main">
          <div className="wc-footer-brand">
            <Link
              className="wc-footer-logo"
              href="/"
              aria-label="Wok and Chop home"
            >
              <img
                src="/images/brand/wok-and-chop-horizontal-white.png"
                width={900}
                height={300}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </Link>
            <p>
              <InkInscription>客家</InkInscription> Halal Hakka Chinese
            </p>
          </div>
          <nav className="wc-footer-links" aria-labelledby="footer-dine-title">
            <h2 id="footer-dine-title">Dine with us</h2>
            <ul>
              <li>
                <Link href="/menu/">Menu</Link>
              </li>
              <li>
                <Link href="/order/">Order online</Link>
              </li>
              <li>
                <Link href="/order/#book-a-table">Book a table</Link>
              </li>
            </ul>
          </nav>
          <nav
            className="wc-footer-links"
            aria-labelledby="footer-explore-title"
          >
            <h2 id="footer-explore-title">Wok &amp; Chop</h2>
            <ul>
              <li>
                <Link href="/our-story/">Our story</Link>
              </li>
              <li>
                <Link href="/contact/">Contact us</Link>
              </li>
              <li>
                <Link href="/account/">Your account</Link>
              </li>
              <li>
                <Link href="/offers/">Email offers</Link>
              </li>
            </ul>
          </nav>
          <div className="wc-footer-visit">
            <h2>Visit in Kanata</h2>
            <address>
              790 Kanata Avenue, Unit M2A
              <br />
              Kanata, Ontario
            </address>
            <a className="wc-footer-phone" href="tel:+16135911111">
              (613) 591-1111
            </a>
          </div>
        </div>
        <div className="wc-footer-bottom">
          <nav aria-label="Staff and site policies">
            <ul>
              <li>
                <Link href="/staff/sign-in/">Staff sign-in</Link>
              </li>
              <li>
                <Link href="/privacy/">Privacy</Link>
              </li>
              <li>
                <Link href="/terms/">Terms &amp; Conditions</Link>
              </li>
              <li>
                <CookieSettingsButton className="wc-footer-cookie" />
              </li>
            </ul>
          </nav>
          <a className="wc-footer-to-top" href="#">
            Back to top <span aria-hidden="true">↑</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
