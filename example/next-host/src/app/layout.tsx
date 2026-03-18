import type { Metadata } from "next";

import "./globals.css";

import { Providers } from "../components/providers";

export const metadata: Metadata = {
  title: "Kuma Test Lab",
  description: "Playful test surfaces for Agent Picker browser automation, dual-agent chat, and E2E workflows.",
  icons: {
    icon: "/kuma-sudoku-icon.png",
    apple: "/kuma-sudoku-icon.png",
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
