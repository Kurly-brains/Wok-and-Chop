import type { Metadata } from "next";
import Storefront from "../../components/storefront";

export const metadata: Metadata = {
  title: "Order Pickup or Delivery · Wok & Chop",
  description: "Order pickup from Wok & Chop in Kanata or get delivery through Uber Eats.",
};

export default function OrderPage() {
  return <Storefront page="order" />;
}
