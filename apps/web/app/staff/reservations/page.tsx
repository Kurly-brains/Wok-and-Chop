import type { Metadata } from "next";
import GuestServicesDesk from "../../../components/operations/GuestServicesDesk";
import { requireStaff } from "../../../lib/require-staff";
import "../../../styles/operations.css";
import "../../../styles/customer-directory.css";
import "../../../styles/guest-services-desk.css";

export const metadata: Metadata = {
  title: "Reservations · Wok & Chop",
  robots: { index: false, follow: false },
};

export default async function ReservationsPage() {
  await requireStaff("reservations");
  return <GuestServicesDesk />;
}
