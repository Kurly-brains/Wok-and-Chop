import type { Metadata } from "next";
import { StaffMarketing } from "../../../components/operations/StaffMarketing";
import { requireStaff } from "../../../lib/require-staff";
import "../../../styles/operations.css";

export const metadata: Metadata = {
  title: "Marketing · Wok & Chop",
  robots: { index: false, follow: false },
};

export default async function MarketingPage() {
  await requireStaff("marketing");
  return <StaffMarketing />;
}
