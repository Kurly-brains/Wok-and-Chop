import type { Metadata } from "next";
import { DeliveryWorkspace } from "../../components/operations/DeliveryWorkspace";
import { requireStaff } from "../../lib/require-staff";
import "../../styles/operations.css";

export const metadata: Metadata = { title: "Kitchen display · Wok & Chop", robots: { index: false, follow: false } };

export default async function Page() {
  await requireStaff("kitchen");
  return <DeliveryWorkspace screen="kitchen" />;
}
