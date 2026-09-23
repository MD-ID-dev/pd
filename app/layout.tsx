import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UH Professional Development Hub",
  description: "Discover professional learning opportunities across the University of Hawaiʻi system.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
