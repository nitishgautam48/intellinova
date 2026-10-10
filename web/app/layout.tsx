import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/providers";
import { themeScript } from "@/lib/theme";

import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "@fontsource-variable/jetbrains-mono";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IntelliNova — your AI study partner", template: "%s · IntelliNova" },
  description:
    "Turn your class material into a tutor that shows its work. Ask doubts, take adaptive quizzes and revise, with answers linked to the page, slide or moment they came from.",
  manifest: "/manifest.json",
  applicationName: "IntelliNova",
  appleWebApp: { capable: true, title: "IntelliNova", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d1413" },
    { media: "(prefers-color-scheme: light)", color: "#f4f7f6" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Newer browsers return a Promise from scroll methods. Code (ours or a library's) that returns one of
// those calls from a React effect makes React treat the Promise as a cleanup function and crash with
// "u is not a function" on the next page change. Return nothing, as these methods always used to.
const scrollGuard = `(function(){try{var t=[[Element.prototype,["scrollIntoView","scrollTo","scrollBy","scroll"]],[window,["scrollTo","scrollBy","scroll"]]];t.forEach(function(e){e[1].forEach(function(n){var f=e[0][n];if(typeof f==="function"){e[0][n]=function(){f.apply(this,arguments)}}})})}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: scrollGuard }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
