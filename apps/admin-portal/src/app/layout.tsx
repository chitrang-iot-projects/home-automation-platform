import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home Automation — Admin",
  description: "Admin Portal for the Home Automation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
