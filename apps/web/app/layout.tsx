import type { Metadata } from "next";
import RouteScroll from "../components/route-scroll";
import "./globals.css";
import "../styles/reference-theme.css";
import "../styles/dish-customizer.css";
export const metadata: Metadata = {
  metadataBase: new URL("http://127.0.0.1:3000"),
  title: "Wok & Chop — Hakka Chinese in Kanata",
  description:
    "Halal Hakka Chinese at 790 Kanata Ave, Unit M2A, Kanata. Explore the Wok & Chop restaurant website design preview.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Wok & Chop — Big Wok. Bold Flavour.",
    description:
      "A Hakka Chinese kitchen in Kanata. Restaurant design preview.",
    images: [
      {
        url: "/images/hakka-table.jpg",
        width: 1536,
        height: 1024,
        alt: "Illustrative Hakka noodle and chilli chicken spread",
      },
    ],
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Set this before the browser can restore the previous offset on reload. */}
        <script dangerouslySetInnerHTML={{ __html: 'if ("scrollRestoration" in history) history.scrollRestoration = "manual";' }} />
      </head>
      <body>
        {children}
        <RouteScroll />
      </body>
    </html>
  );
}
