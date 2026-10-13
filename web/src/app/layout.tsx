import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "../components/Providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Darwin | Baskets of real-world assets on Stellar", template: "Darwin | %s" },
  description:
    "Buy a whole portfolio of tokenized treasuries, stablebonds, gold and crypto with USDC in one Stellar transaction. Priced live on-chain by Reflector.",
  openGraph: {
    title: "Darwin on Stellar",
    description: "One token, a whole strategy. RWA baskets on Soroban.",
    siteName: "Darwin",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://soroban-testnet.stellar.org" crossOrigin="anonymous" />
      </head>
      {/* Browser extensions inject attributes onto <body> before hydration — benign mismatch. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
