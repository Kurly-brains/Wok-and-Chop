import type { Metadata } from "next";
import MenuEditor from "../../../components/menu-editor";
import "../../../styles/operations.css";
import "../../../styles/customer-directory.css";
import "../../../styles/menu-editor.css";

export const metadata: Metadata = {
  title: "Lunch menu editor · Wok & Chop",
  description:
    "Manage the shared lunch menu, prices and photos for the local ordering preview.",
  robots: { index: false, follow: false },
};

export default function MenuEditorPage() {
  return <MenuEditor />;
}
