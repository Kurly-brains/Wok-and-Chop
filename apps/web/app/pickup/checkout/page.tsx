import type { Metadata } from "next";
import Storefront from "../../../components/storefront";

export const metadata: Metadata = {
  title: "Pickup checkout · Wok & Chop",
  description: "Review your pickup order at Wok & Chop in Kanata.",
};

export default function PickupCheckoutPage() {
  return <Storefront page="pickup" />;
}
