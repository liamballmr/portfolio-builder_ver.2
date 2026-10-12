import type { Metadata } from "next";
// @ts-ignore Next.js handles global CSS imports through its bundler.
import "./globals.css";

export const metadata: Metadata = {
  title: "Liam — Portfolio Book",
  description: "A considered collection of work by Liam.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
