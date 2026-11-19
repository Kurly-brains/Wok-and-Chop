import type { Metadata } from "next";
import { KitchenDisplay } from "../../../components/operations/KitchenDisplay";
import "../../../styles/operations.css";

export const metadata: Metadata = { title: "Training kitchen display · Wok & Chop", robots: { index: false, follow: false } };

export default function KitchenPage() { return <KitchenDisplay />; }

