import type { Metadata } from "next";

import "./globals.css";

import { Providers } from "../components/providers";

export const metadata: Metadata = {
  title: "Kuma Sudoku Club",
  description: "A playful Sudoku test surface for Agent Picker browser automation and E2E workflows.",
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
