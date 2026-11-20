import type { Metadata } from "next";
import Link from "next/link";
import InkInscription from "../../components/ink-inscription";
import { uberEatsUrl } from "../../lib/ordering";

export const metadata: Metadata = { title: "Terms & Conditions | Wok & Chop" };

export default function TermsPage() {
  return (
    <main className="privacy-page">
      <div className="inscription-line">
        <Link href="/">← Wok &amp; Chop</Link>
        <InkInscription>客家</InkInscription>
      </div>
      <h1>Terms &amp; Conditions</h1>
      <p>
        These terms describe ordering, reservations and accounts on the Wok
        &amp; Chop website.
      </p>

      <h2>Pickup from Wok &amp; Chop</h2>
      <p>
        Menu prices are in Canadian dollars. Review your dishes, choices and
        food total before submitting. When direct pickup checkout is available,
        payment and applicable tax are handled at the restaurant. Use the order
        status to check when your food is ready and bring your order number for
        collection.
      </p>
      <p>
        The local checkout is for sample details and unpaid test orders only.
      </p>

      <h2>Uber Eats</h2>
      <p>
        Home delivery and any pickup you choose through{" "}
        <a href={uberEatsUrl}>Uber Eats</a> are ordered and paid for on its
        platform. Check Uber Eats for its current pricing, fees, tracking, order
        changes and refund support.
      </p>

      <h2>Table reservations</h2>
      <p>
        A submitted form is a request. Wait for confirmation from the restaurant
        before arriving. Reservation times are in Toronto time. Contact the
        restaurant if your date, time or party size changes.
      </p>

      <h2>Changes, cancellations and order issues</h2>
      <p>
        Contact the restaurant as soon as possible about a direct pickup or
        reservation. Have your order or booking number ready. Your rights under
        applicable consumer law are preserved.
      </p>

      <h2>Food allergies</h2>
      <p>
        Speak with the restaurant before ordering if you have an allergy. A
        preparation note cannot guarantee an allergen-free meal.
      </p>

      <h2>Accounts and privacy</h2>
      <p>
        Use contact details you can access and keep your sign-in, password reset
        code and order tracking code private.
      </p>
      <Link href="/privacy/">Privacy &amp; cookies ↗</Link>

      <h2>Contact the restaurant</h2>
      <p>Wok &amp; Chop · 790 Kanata Avenue, Unit M2A, Kanata, Ontario</p>
      <p>
        <a href="tel:+16135911111">(613) 591-1111</a> ·{" "}
        <a href="mailto:info@wokandchop.ca">info@wokandchop.ca</a>
      </p>
    </main>
  );
}
