import type { Metadata } from "next";
import { DeliveryWorkspace } from "../../components/operations/DeliveryWorkspace";
import "../../styles/operations.css";

export const metadata: Metadata = { title: "Kitchen display · Wok & Chop", robots: { index: false, follow: false } };

export default function Page() { return <DeliveryWorkspace screen="kitchen" />; }
