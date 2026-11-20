import Link from "next/link";
import type { Metadata } from "next";
import { CookieSettingsButton } from "../../components/cookie-settings";
import InkInscription from "../../components/ink-inscription";

export const metadata: Metadata = { title: "Privacy & Cookies | Wok & Chop" };
export default function Privacy() {
  return (
    <main className="privacy-page">
      <div className="inscription-line"><Link href="/">← Wok &amp; Chop</Link><InkInscription>客家</InkInscription></div>
      <h1>Privacy &amp; cookies</h1>
      <p>
        When you place an order for pickup directly with Wok &amp; Chop, the
        restaurant uses your name, phone number and order details to prepare
        your food and contact you about the order. If you provide an email,
        it is used for pickup updates. You pay at the restaurant.
        During local testing, use sample contact and order details.
      </p>
      <h2>Contact forms and table requests</h2>
      <p>
        The restaurant uses your message or booking details, including the
        contact information you enter, to respond and manage your visit.
        When email is configured, Hostinger delivers messages to guests and
        to the restaurant’s staff inbox.
      </p>
      <h2>Ordering on Uber Eats</h2>
      <p>
        If you choose Uber Eats for delivery or pickup, you finish your order on
        its website or app. Uber Eats handles your order, payment and tracking
        under its own privacy policy.
      </p>
      <h2>Email offers</h2>
      <p>
        Wok &amp; Chop uses your email address and records of your signup,
        confirmation and unsubscribe requests to manage optional offers.
        Hostinger delivers these emails. Use the unsubscribe link in any
        offer to stop marketing emails. Pickup and booking updates are managed
        separately.
      </p>
      <h2>Your bag</h2>
      <p>
        Your bag is saved in this browser. Removing an item also removes its
        preparation note. Use sample information when testing orders.
      </p>
      <h2>Customer accounts</h2>
      <p>
        If you create an account, your name, email, password hash, and session
        records are stored in the restaurant’s PostgreSQL database. Passwords
        are salted and hashed, and the browser uses an HttpOnly session cookie.
        Signing out revokes your session. You can browse the menu and order
        pickup directly as a guest.
      </p>
      <p>
        Signed-in customers can view delivery and pickup receipts linked to their account.
        Designated restaurant managers can look up customer accounts and their
        recorded orders in the local directory.
      </p>
      <p>
        Keep your pickup receipt code and any earlier delivery tracking codes
        private. Anyone with your code can view the relevant order status and
        food summary.
      </p>
      <p>
        When email is configured, password recovery uses a short-lived code
        sent to your account email. Completing the reset revokes your existing
        sessions. Please use test details during development.
      </p>
      <h2>Guest reviews and photos</h2>
      <p>
        The guestbook shows selected review excerpts and links to their sources.
        If you enable Google photos, your browser requests the photos and avatars from Google.
      </p>
      <h2 id="cookies">Cookies and browser storage</h2>
      <p>
        A session cookie keeps you signed in. The browser stores your bag,
        private tracking details for the active session, and any dish choices
        you ask it to remember. It also remembers your privacy preference on this device.
        Turning off Google photos stops new photo requests from this site.
      </p>
      <CookieSettingsButton className="wc-cookie-settings-policy" />
      <h2>Privacy questions</h2>
      <p>Contact <a href="mailto:info@wokandchop.ca">info@wokandchop.ca</a> with questions about your information.</p>
      <Link href="/terms/">Terms &amp; Conditions ↗</Link>
    </main>
  );
}
