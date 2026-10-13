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
          <img src={w.icon} alt="" width={36} height={36} className="wm-icon" />
          <span className="wm-name">{w.name}</span>
          {pending === w.id && <span className="wm-spin toast-spin" aria-hidden />}
        </button>
      ))}
      {wallets?.length === 0 && (
        <a href="https://www.freighter.app" target="_blank" rel="noopener noreferrer" className="wm-note wm-link">
          No Stellar wallet found. Get Freighter →
        </a>
      )}
      <div className="wm-foot">Switch the wallet to testnet.</div>
    </div>
  );
}
