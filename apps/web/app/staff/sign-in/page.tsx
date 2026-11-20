import type { Metadata } from "next";
import StaffSignIn from "../../../components/operations/StaffSignIn";
import { staffWorkspaces, type StaffWorkspace } from "../../../lib/staff-routes";
import "../../../styles/operations.css";

export const metadata: Metadata = {
  title: "Staff sign-in · Wok & Chop",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const requested = typeof next === "string" ? next : "";
  const destination = Object.hasOwn(staffWorkspaces, requested)
    ? staffWorkspaces[requested as StaffWorkspace]
    : Object.values(staffWorkspaces).find(path => path === requested) ?? staffWorkspaces.overview;

  return <StaffSignIn destination={destination} />;
}
