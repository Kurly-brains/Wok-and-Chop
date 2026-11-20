import type { Metadata } from "next";
import Storefront from "../../components/storefront";

export const metadata: Metadata = {
  title: "Contact Us — Wok & Chop",
  description:
    "Contact Wok & Chop or request a table at 790 Kanata Avenue, Unit M2A, Kanata, Ontario.",
  alternates: { canonical: "/contact/" },
};

export default function ContactPage() {
  return <Storefront page="visit" />;
}
