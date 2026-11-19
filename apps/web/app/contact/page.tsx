import type { Metadata } from "next";
import Storefront from "../../components/storefront";

export const metadata: Metadata = {
  title: "Contact Us — Wok & Chop",
  description:
    "Call (613) 591-1111, email info@wokandchop.ca, or find Wok & Chop at 790 Kanata Avenue, Unit M2A, Kanata, Ontario.",
  alternates: { canonical: "/contact/" },
};

export default function ContactPage() {
  return <Storefront page="visit" />;
}
