import type { Metadata } from "next";
import { StaffConsole } from "../../../components/operations/StaffConsole";
import "../../../styles/operations.css";

export const metadata: Metadata = { title: "Training order board · Wok & Chop", robots: { index: false, follow: false } };

export default function StaffPage() { return <StaffConsole />; }

