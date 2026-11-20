import type { Metadata } from "next";
import { OfferSignup } from "../../components/offer-preferences";
import Storefront from "../../components/storefront";

export const metadata: Metadata = {
  title: "Email offers · Wok & Chop",
  description: "Sign up for occasional offers from Wok & Chop in Kanata.",
  alternates: { canonical: "/offers/" },
};

export default function OffersPage() {
  return (
    <Storefront page="offers">
      <OfferSignup />
    </Storefront>
  );
}
