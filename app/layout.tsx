import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Atelier",
  description: "Multi-agent web application generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`dark ${inter.variable} h-full antialiased`}>
        <body className="min-h-full bg-zinc-950 text-foreground">{children}</body>
      </html>
    </ClerkProvider>
  );
}
