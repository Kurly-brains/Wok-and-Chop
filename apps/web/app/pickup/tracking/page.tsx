import type { Metadata } from "next";
import Storefront from "../../../components/storefront";

export const metadata: Metadata = {
  title: "Track a pickup · Wok & Chop",
  robots: { index: false, follow: false },
};

export default function PickupTrackingPage() {
  return <Storefront page="pickup-tracking" />;
}
