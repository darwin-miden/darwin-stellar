"use client";

/**
 * The connect menu: a small dropdown under the Connect wallet button that lists only the Stellar
 * wallets this device can reach (installed extensions, plus the web wallets that always work).
 * One click connects that wallet; nothing else to choose.
 */

import { useEffect, useState } from "react";

import { listWallets, type DeviceWallet } from "../../lib/wallet";

export function WalletMenu({
  onPick,
  onClose,
  pending,
}: {
  onPick: (walletId: string) => void;
  onClose: () => void;
  /** Wallet currently being connected, if any. */
  pending: string | null;
}) {
  const [wallets, setWallets] = useState<DeviceWallet[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    listWallets()
      .then((w) => live && setWallets(w))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // Close on a click outside (the Connect button toggles it itself) or Escape.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".wm-anchor")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="wm-menu" role="menu" aria-label="Stellar wallets">
      {wallets === null && !failed && <div className="wm-note">Looking for wallets…</div>}
      {failed && <div className="wm-note">Couldn&rsquo;t load wallets. Try again.</div>}
      {wallets?.map((w) => (
        <button
          key={w.id}
          type="button"
          role="menuitem"
          className="wm-item"
          disabled={pending !== null}
          aria-busy={pending === w.id}
          onClick={() => onPick(w.id)}
        >
          <img src={w.icon} alt="" width={24} height={24} className="wm-icon" />
          <span className="wm-name">{w.name}</span>
          {pending === w.id && <span className="wm-spin toast-spin" aria-hidden />}
        </button>
      ))}
      {wallets?.length === 0 && (
        <a href="https://www.freighter.app" target="_blank" rel="noopener noreferrer" className="wm-note wm-link">
          No Stellar wallet found. Get Freighter →
        </a>
      )}
    </div>
  );
}

/** The account menu, same dropdown: copy the address, or disconnect. */
export function AccountMenu({
  address,
  walletName,
  onDisconnect,
  onClose,
}: {
  address: string;
  walletName: string | null;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".wm-anchor")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="wm-menu" role="menu" aria-label="Account">
      {walletName && <div className="wm-head">{walletName}</div>}
      <button type="button" role="menuitem" className="wm-item" onClick={() => void copy()}>
        <span className="wm-glyph" aria-hidden>
          {copied ? (
            <svg {...glyph}>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg {...glyph}>
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </span>
        <span className="wm-name">{copied ? "Copied!" : "Copy address"}</span>
      </button>
      <button type="button" role="menuitem" className="wm-item" onClick={onDisconnect}>
        <span className="wm-glyph" aria-hidden>
          <svg {...glyph}>
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
          </svg>
        </span>
        <span className="wm-name">Disconnect</span>
      </button>
    </div>
  );
}

const glyph = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
