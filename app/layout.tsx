import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import { Afacad } from "next/font/google";
import "./globals.css";

// Brand body font. The theme file decides where it is used.
const afacad = Afacad({ subsets: ["latin"], variable: "--font-afacad", display: "swap" });

export const metadata: Metadata = {
  title: "Seams",
  description: "Find where two utilities' planned grid projects overlap.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${afacad.variable}`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
