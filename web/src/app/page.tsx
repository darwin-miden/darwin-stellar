"use client";

import dynamic from "next/dynamic";

import { LogoFull } from "../components/Logo";
import { HomeFallback } from "../components/darwin/HomeFallback";
import { AppErrorBoundary } from "../components/para/AppErrorBoundary";
import { ToastProvider } from "../components/para/Toast";
import { WalletProvider } from "../lib/wallet";

// Client-only: the wallet kit and the Soroban client touch `window`. While the chunk loads, paint
// the SAME frame the mounted app uses (same height, so nothing shifts) with the whole Baskets page
// inside it, which fetches its own on-chain prices — so a reload never shows an empty panel.
const App = dynamic(() => import("../components/para/App").then((m) => m.App), {
  ssr: false,
  loading: () => (
    <div
      className="frame-gradient"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        fontFamily: "var(--font-sans-stack)",
        color: "var(--ink)",
      }}
    >
      <div style={{ flexShrink: 0, padding: "2px 10px 0" }}>
        <header className="relative z-50 px-4 md:pl-6 md:pr-[24px] py-3 md:py-[11px]">
          <div className="flex items-center" style={{ minHeight: 44 }}>
            <span className="nav-logo flex items-center shrink-0" style={{ filter: "invert(1) brightness(2)" }}>
              <LogoFull aria-label="Darwin" />
            </span>
          </div>
        </header>
      </div>
      <div
        className="frame-panel frame-panel-rounded"
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", margin: "4px 10px 10px" }}
      >
        <HomeFallback />
      </div>
    </div>
  ),
});

export default function Page() {
  return (
    <AppErrorBoundary>
      <ToastProvider>
        <WalletProvider>
          <App />
        </WalletProvider>
      </ToastProvider>
    </AppErrorBoundary>
  );
}
