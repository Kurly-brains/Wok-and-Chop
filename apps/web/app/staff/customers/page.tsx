import type { Metadata } from "next";
import CustomerDirectory from "../../../components/operations/CustomerDirectory";
import "../../../styles/operations.css";
import "../../../styles/customer-directory.css";

export const metadata: Metadata = {
  title: "Customers · Wok & Chop",
  robots: { index: false, follow: false },
};

export default function CustomersPage() {
  return <CustomerDirectory />;
}
