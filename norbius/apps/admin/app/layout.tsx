import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NORBIUS Admin", template: "%s · NORBIUS Admin" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#050505", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-bg text-fg">{children}</body>
    </html>
  );
}
