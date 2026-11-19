import type { Metadata } from "next";
import MenuEditor from "../../../components/menu-editor";
import "../../../styles/operations.css";
import "../../../styles/menu-editor.css";

export const metadata: Metadata = {
  title: "Local menu workspace · Wok & Chop",
  description:
    "Preview menu details and photo framing in this browser. Changes are not published.",
  robots: { index: false, follow: false },
};

export default function MenuEditorPage() {
  return <MenuEditor />;
}
