"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { LogoFull } from "../Logo";
import { withBase } from "@/lib/basePath";

/**
 * Agama's navbar, replicated with its EXACT markup + Tailwind classes (recolored to Darwin orange):
 * logo left · a centered rounded pill-bar of tabs · a right cluster (network pill + connect / account).
 * Renders on the orange frame gradient (AgamaFrame), so text is white/cream.
 */
export function AgamaNavbar({
  tabs,
  activeTab,
  onTab,
  right,
}: {
  tabs: string[];
  activeTab?: string;
  onTab?: (t: string) => void;
  right: ReactNode;
}) {
  return (
    <header className="relative z-50 px-4 md:pl-6 md:pr-[24px] py-3 md:py-[11px]">
      <div className="flex items-center justify-between gap-3">
        {/* Left: logo */}
        <span className="nav-logo flex items-center shrink-0" style={{ filter: "invert(1) brightness(2)" }}>
          <LogoFull aria-label="Darwin" />
        </span>

        {/* Center: pill-bar of tabs (exact Agama classes) */}
        <nav className="hidden md:flex pill-bar items-center gap-1 rounded-full h-[47px] -mb-[3px] px-[3.5px] mr-auto ml-10">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab?.(t)}
              className={clsx(
                "flex items-center rounded-full text-white transition-colors h-10 px-4 md:px-5 text-[14px]",
                t === activeTab ? "pill-active" : "hover:bg-white/10",
              )}
            >
              {t}
            </button>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-2 shrink-0">{right}</div>
      </div>
    </header>
  );
}

/** Network selector — Agama's EXACT pill-outline shape: a circular network icon + chevron (no label). */
export function NetworkPill() {
  return (
    <button
      type="button"
      className="pill-outline flex items-center gap-0.5 rounded-full h-10 pl-[6px] pr-[7px] text-white"
      aria-label="Stellar testnet"
      title="Stellar testnet"
    >
      <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBase("/stellar.svg")} alt="Stellar" className="h-[20px] w-[20px] object-cover" />
      </span>
      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Connect / action pill button — Agama's exact button classes (pill-outline). */
/** One fixed width for the far-right slot, so it reads the same in all three states:
 *  "Connect wallet" on the landing, "Cancel" while signing in, the account pill once connected.
 *  135px is the Connect wallet width; the widest label (the account + power icon) measures 130. */
export const NAV_ACTION_WIDTH = "w-[135px] justify-center overflow-hidden";

/**
 * The header slot while the wallet's own popup is up. The popup already owns the decision
 * (Deny / Connect), so this reports state instead of offering a competing choice — but it stays
 * clickable, otherwise a popup lost behind the window would strand the user.
 */
export function SigningInPill({ onCancel }: { onCancel?: () => void }) {
  return (
    <NavPillButton onClick={onCancel} title="Cancel sign-in" className={`${NAV_ACTION_WIDTH} gap-2`}>
      <span
        className="toast-spin"
        aria-hidden
        style={{
          width: 13,
          height: 13,
          borderRadius: "50%",
          border: "2px solid rgba(253,248,237,0.35)",
          borderTopColor: "#fdf8ed",
          flex: "none",
        }}
      />
      Signing in…
    </NavPillButton>
  );
}

export function NavPillButton({
  children,
  onClick,
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={clsx("pill-outline inline-flex items-center rounded-full h-10 px-[17px] text-[14px] font-medium whitespace-nowrap text-white", className)}
    >
      {children}
    </button>
  );
}
