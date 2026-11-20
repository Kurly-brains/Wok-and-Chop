import type { Metadata } from "next";
import Storefront from "../../../components/storefront";

export const metadata: Metadata = {
  title: "Track a Past Delivery · Wok & Chop",
  robots: { index: false, follow: false },
};

export default function TrackingPage() {
  return <Storefront page="delivery-tracking" />;
}
