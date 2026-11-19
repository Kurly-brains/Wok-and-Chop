import type { Metadata } from "next";
import { DeliveryWorkspace } from "../../components/operations/DeliveryWorkspace";
import "../../styles/operations.css";

export const metadata: Metadata = { title: "Delivery desk · Wok & Chop", robots: { index: false, follow: false } };

export default function Page() { return <DeliveryWorkspace screen="staff" />; }
