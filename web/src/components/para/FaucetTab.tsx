"use client";

/**
 * Faucet tab — get funded on Stellar testnet, laid out like Agama's Stellar faucet: a hero with
 * the three numbers that matter, then one row per step left. A step that is done is not shown
 * (activating happens once), so the list only ever holds what is left to do.
 *
 * Darwin's baskets settle in a test USDC issued on-chain by Darwin (a SEP-41 contract token, so
 * no trustline): one signature claims 1,000 USDC, once an hour.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { EXPLORER, USDC } from "../../lib/config";
import { formatUnits, toNum, useData } from "../../lib/data";
import { addr, ensureFunded, simulateAs, write } from "../../lib/stellar";
import { useWallet } from "../../lib/wallet";
import { useToast } from "./Toast";
import { withBase } from "@/lib/basePath";

const WORDS = ["", "One step", "Two steps", "Three steps"];

export function FaucetTab({ onConnect, onGoBaskets }: { onConnect: () => void; onGoBaskets: () => void }) {
  const { address, sign } = useWallet();
  const { balances, refresh } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<"activate" | "claim" | null>(null);
  const [copied, setCopied] = useState(false);
  // null = not checked yet. The faucet allows one claim an hour; a dry run says whether now works.
  const [canClaim, setCanClaim] = useState<boolean | null>(null);

  const usdc = balances?.usdc;
  // xlm === null: Horizon has no account at this address yet (never funded).
  const activated = !address || balances === null || balances.xlm !== null;
  const showActivate = !activated;
  const steps = (showActivate ? 1 : 0) + 1;

  const checkClaim = useCallback(async () => {
    if (!address) return setCanClaim(null);
    try {
      await simulateAs(address, USDC, "faucet", [addr(address)]);
      setCanClaim(true);
    } catch (e) {
      setCanClaim(/cooldown/i.test(String((e as Error)?.message)) ? false : true);
    }
  }, [address]);
  useEffect(() => {
    void checkClaim();
  }, [checkClaim, usdc]);

  async function activate() {
    if (!address) return;
    setBusy("activate");
    try {
      await ensureFunded(address);
      toast.push({ type: "success", title: "Account activated ✓", message: "Friendbot sent testnet XLM for fees." });
      refresh();
    } catch (e) {
      toast.push({ type: "error", title: "Activation failed", message: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(null);
    }
  }

  async function claim() {
    if (!address) return;
    setBusy("claim");
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
      setCanClaim(false);
      refresh();
    } catch (e) {
      toast.update(id, { type: "error", title: "Claim failed", message: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(null);
    }
  }

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const claimBlurb = !address
    ? "Connect your wallet first. One signature claims 1,000 test USDC, once an hour."
    : canClaim === false
      ? "Claimed. The faucet refills every hour."
      : "One signature, 1,000 test USDC straight to your wallet. Once an hour.";

  return (
    <main className="fc-page">
      <section className="fc-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBase("/logos/usdc.svg")} alt="" className="fc-hero-mark" />
        <h1 className="fc-title">Get USDC</h1>
        <p className="fc-lead">
          Darwin on Stellar settles in a test USDC issued on-chain, so baskets can be bought and sold for real on
          testnet. {steps === 1 ? "One step left" : WORDS[steps]} and you are funded.
        </p>
        <div className="fc-stats">
          <Stat label="Network" value="Stellar Testnet" />
          <Stat label="Asset" value="Test USDC" />
          <Stat label="Your USDC" value={address && usdc !== undefined ? toNum(usdc).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"} />
        </div>
      </section>

      <section className="fc-steps">
        <h2 className="fc-steps-title">{WORDS[steps]}</h2>

        {showActivate && (
          <StepRow
            icon={withBase("/stellar.svg")}
            title="Activate your account"
            blurb="A Stellar address becomes an account when something funds it. Friendbot does it on testnet, for free, and nothing is signed."
          >
            <button type="button" className="fc-btn fc-btn-ink" onClick={activate} disabled={busy !== null}>
              {busy === "activate" ? "Activating…" : "Activate"}
            </button>
          </StepRow>
        )}

        <StepRow icon={withBase("/logos/usdc.svg")} done={!!usdc && usdc > 0n} title="Claim 1,000 test USDC" blurb={claimBlurb}>
          <div className="fc-actions">
            <button type="button" className="fc-btn fc-btn-soft" onClick={copyAddress} disabled={!address}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied!" : "Copy address"}
            </button>
            {address ? (
              <button
                type="button"
                className="fc-btn fc-btn-ink"
                onClick={claim}
                disabled={busy !== null || showActivate || canClaim === false}
              >
                {busy === "claim" ? "Claiming…" : canClaim === false ? "Claimed" : "Claim USDC"}
              </button>
            ) : (
              <button type="button" className="fc-btn fc-btn-ink" onClick={onConnect}>
                Connect wallet
              </button>
            )}
          </div>
        </StepRow>

        <button type="button" className="fc-next" onClick={onGoBaskets}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBase("/logos/rwa/USTRY.svg")} alt="" className="fc-next-mark" />
          <span>
            <span className="fc-next-title">Funded? Buy a basket</span>
            <span className="fc-next-sub">Treasuries, stablebonds, gold and crypto, in one transaction</span>
          </span>
          <ArrowIcon />
        </button>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="fc-stat-label">{label}</div>
      <div className="fc-stat-value">{value}</div>
    </div>
  );
}

function StepRow({
  icon,
  done,
  title,
  blurb,
  children,
}: {
  icon: string;
  done?: boolean;
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div className="fc-row">
      {done ? (
        <span className="fc-done">
          <CheckIcon />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" className="fc-row-mark" />
      )}
      <div className="fc-row-body">
        <div className="fc-row-title">{title}</div>
        <div className="fc-row-blurb">{blurb}</div>
      </div>
      <div className="fc-row-cta">{children}</div>
    </div>
  );
}

const svg = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function CopyIcon() {
  return (
    <svg {...svg} aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg {...svg} width={20} height={20} className="fc-next-arrow" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
