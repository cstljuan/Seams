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

// Runs before paint so the page never flashes the wrong theme.
// Uses the saved choice, else the device setting (and follows it while nothing is saved).
const themeScript = `(function(){var m=matchMedia("(prefers-color-scheme: dark)");function s(){var t;try{t=localStorage.getItem("seams-theme")}catch(e){}document.documentElement.dataset.theme=t==="dark"||t==="light"?t:m.matches?"dark":"light"}s();m.addEventListener("change",s)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the script before React loads, so skip the mismatch warning.
    <html lang="en" className={`h-full antialiased ${afacad.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
