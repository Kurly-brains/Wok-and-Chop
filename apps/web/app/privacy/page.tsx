import Link from "next/link";
import InkInscription from "../../components/ink-inscription";
export default function Privacy() {
  return (
    <main className="privacy-page">
      <div className="inscription-line"><Link href="/">← Wok &amp; Chop</Link><InkInscription>客家</InkInscription></div>
      <h1>Privacy & local development</h1>
      <p>
        This local restaurant website uses sample promotions, practice orders,
        and generated food imagery. Test delivery checkout saves order and
        contact details to local PostgreSQL without collecting any payment.
      </p>
      <h2>Your bag</h2>
      <p>
        Your bag is saved in this browser. Removing an item also removes its
        preparation note. Keep personal or sensitive information out of test
        orders. The staff training board saves practice tickets on the local
        restaurant service so the order board and kitchen display can share them.
      </p>
      <h2>Customer accounts</h2>
      <p>
        If you create an account, your name, email, password hash, and session
        records are stored in a separate PostgreSQL database on this development
        computer. Passwords are salted and hashed, and the browser uses an
        HttpOnly session cookie. Signing out revokes your session. Guest
        browsing and test delivery checkout require no account.
      </p>
      <p>
        Signed-in customers can view delivery and pickup receipts linked to their account.
        Designated restaurant managers can look up customer accounts and their
        recorded orders in the local directory.
      </p>
      <p>
        The delivery tracker uses a private code. The browser keeps the code in
        this tab’s session so you can revisit the order. Anyone with your code
        can see the order status and food summary, so keep it private.
      </p>
      <p>
        Please use test details during development. Email verification and
        password recovery are not enabled. This account system is not approved
        for production use.
      </p>
      <h2>Guest reviews and photos</h2>
      <p>
        The guestbook shows selected reviews from Google. When you view the
        photos, your browser requests them from Google. Each excerpt links to
        its original review.
      </p>
      <h2>Before restaurant launch</h2>
      <p>
        The approved menu, photos, hours, contact details, tax rules, policies,
        production privacy notice, customer support process, and live services
        must be configured and verified before online ordering opens.
      </p>
      <Link href="/menu/">View the menu ↗</Link>
    </main>
  );
}
