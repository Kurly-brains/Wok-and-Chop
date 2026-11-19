import type { Metadata } from "next";
import DeliveryReports from "../../../components/operations/DeliveryReports";
import "../../../styles/operations.css";
import "../../../styles/customer-directory.css";
import "../../../styles/delivery-reports.css";

export const metadata: Metadata = {
  title: "Delivery reports · Wok & Chop",
  robots: { index: false, follow: false },
};

export default function ReportsPage() {
  return <DeliveryReports />;
}
