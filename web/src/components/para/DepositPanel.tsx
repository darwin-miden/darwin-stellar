"use client";

/**
 * Deposit — testnet funding in one place: claim test USDC from the on-chain faucet (1,000 / hour),
 * top up XLM for fees via friendbot, or receive to your address from any Stellar wallet.
 */

import { useState } from "react";

import { EXPLORER, USDC } from "../../lib/config";
import { formatUnits, useData } from "../../lib/data";
import { addr, ensureFunded, write } from "../../lib/stellar";
import { useWallet } from "../../lib/wallet";
import { useToast } from "./Toast";
import { withBase } from "@/lib/basePath";

export function DepositPanel({ onClose }: { onClose: () => void }) {
  const { address, sign, walletName } = useWallet();
  const { balances, refresh } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<"usdc" | "xlm" | null>(null);
  const [copied, setCopied] = useState(false);

  async function claimUsdc() {
    if (!address) return;
    setBusy("usdc");
    const id = toast.push({ type: "loading", title: "Claiming test USDC…", message: "Confirm in your wallet." });
    try {
      await ensureFunded(address);
      const r = await write<bigint>(address, sign, USDC, "faucet", [addr(address)]);
      toast.update(id, {
        type: "success",
        title: `+${formatUnits(BigInt(r.value), 7, 0)} USDC ✓`,
        message: "Pick a basket to put it to work.",
        action: { label: "View tx", onClick: () => window.open(`${EXPLORER}/tx/${r.hash}`, "_blank", "noopener") },
      });
      refresh();
      onClose();
    } catch (e) {
      toast.update(id, { type: "error", title: "Claim failed", message: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(null);
    }
  }

  async function topUpXlm() {
    if (!address) return;
    setBusy("xlm");
    try {
      const funded = await ensureFunded(address);
      toast.push({
        type: funded ? "success" : "info",
        title: funded ? "Account funded with testnet XLM ✓" : "Your account already has XLM",
        message: funded ? undefined : `${balances?.xlm?.toFixed(2) ?? "…"} XLM available for fees.`,
      });
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 19, fontWeight: 600, margin: "2px 0 0", letterSpacing: "-0.01em" }}>Deposit</h2>
      <p style={{ marginTop: 5, fontSize: 14, color: "var(--ink-3)" }}>Fund your {walletName ?? "wallet"} on Stellar testnet.</p>

      <button type="button" onClick={claimUsdc} disabled={busy != null} className="cx-choice" style={{ marginTop: 18 }}>
        <span className="cx-tile cx-tile-para" style={{ fontWeight: 700, fontSize: 13 }}>
          $
        </span>
        <span className="cx-body">
          <span className="cx-title" style={{ display: "block" }}>
            {busy === "usdc" ? "Claiming…" : "Claim 1,000 test USDC"}
          </span>
          <span className="cx-sub" style={{ display: "block" }}>
            On-chain faucet, once an hour · balance {balances ? formatUnits(balances.usdc, 7, 2) : "…"} USDC
          </span>
        </span>
      </button>

      <button type="button" onClick={topUpXlm} disabled={busy != null} className="cx-choice">
        <span className="cx-tile cx-tile-miden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBase("/stellar.svg")} alt="" width={22} height={22} />
        </span>
        <span className="cx-body">
          <span className="cx-title" style={{ display: "block" }}>
            {busy === "xlm" ? "Funding…" : "Testnet XLM for fees"}
          </span>
          <span className="cx-sub" style={{ display: "block" }}>
            Friendbot · {balances?.xlm != null ? `${balances.xlm.toFixed(2)} XLM` : "…"} available
          </span>
        </span>
      </button>

      <div style={{ marginTop: 18, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>
        Receive from any Stellar wallet
      </div>
      <button
        type="button"
        onClick={() => {
          if (!address) return;
          void navigator.clipboard?.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{
          marginTop: 6,
          width: "100%",
          textAlign: "left",
          borderRadius: 8,
          border: "1px solid var(--rule)",
          background: "var(--paper)",
          padding: "10px 12px",
          fontFamily: "var(--font-mono-stack)",
          fontSize: 12,
          wordBreak: "break-all",
          color: "var(--ink)",
          cursor: "pointer",
        }}
        title="Copy address"
      >
        {address} <span style={{ color: "var(--orange)" }}>{copied ? "copied ✓" : "copy"}</span>
      </button>
    </div>
  );
}
