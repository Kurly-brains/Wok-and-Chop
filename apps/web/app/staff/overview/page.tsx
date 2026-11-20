import type { Metadata } from "next";
import { OperationsShell } from "../../../components/operations/OperationsShell";
import { StaffOverview } from "../../../components/operations/StaffOverview";
import { requireStaff } from "../../../lib/require-staff";
import "../../../styles/operations.css";

export const metadata: Metadata = {
  title: "Staff overview · Wok & Chop",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireStaff("overview");
  return (
    <OperationsShell active="overview">
      <StaffOverview />
    </OperationsShell>
  );
}
