import type { Metadata } from "next";

import "./globals.css";

import { Providers } from "../components/providers";
import { KUMA_TEST_CONNECT_ICON_SRC } from "../lib/kuma-assets";

export const metadata: Metadata = {
  title: "Kuma Test Lab",
  description: "Playful test surfaces for Kuma Picker browser automation, dual-agent chat, and E2E workflows.",
  icons: {
    icon: KUMA_TEST_CONNECT_ICON_SRC,
    apple: KUMA_TEST_CONNECT_ICON_SRC,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
