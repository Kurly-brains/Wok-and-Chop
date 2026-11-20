import type { Metadata } from "next";
import { DeliveryWorkspace } from "../../components/operations/DeliveryWorkspace";
import { requireStaff } from "../../lib/require-staff";
import "../../styles/operations.css";

export const metadata: Metadata = { title: "Order desk · Wok & Chop", robots: { index: false, follow: false } };

export default async function Page() {
  await requireStaff("staff");
  return <DeliveryWorkspace screen="staff" />;
}
