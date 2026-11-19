import type { Metadata } from "next";
import Storefront from "../../components/storefront";

export const metadata: Metadata = {
  title: "Home Delivery · Wok & Chop",
  description: "Review your Wok & Chop delivery and track your order.",
};

export default function DeliveryPage() {
  return <Storefront page="delivery" />;
}
