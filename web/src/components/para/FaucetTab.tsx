"use client";

/**
 * Faucet tab — get funded with real Circle USDC on Stellar testnet, laid out like Agama's Stellar
 * faucet: a hero with the three numbers that matter, then one row per step left. A step that is
 * done is not shown (activating and trusting each happen once), so the list only holds what is
 * left to do.
 *
 * Circle's USDC is a classic Stellar asset, so holding it takes a trustline. Getting it: Circle's
 * own faucet (20 USDC every 2 hours), or a swap of friendbot XLM on the testnet XLM/USDC pool,
 * which gives far more for a demo.
 */

import { useEffect, useState, type ReactNode } from "react";

import { CIRCLE_FAUCET, EXPLORER } from "../../lib/config";
import { toNum, useData } from "../../lib/data";
import { addUsdcTrustline, ensureFunded, quoteXlmToUsdc, swapXlmToUsdc } from "../../lib/stellar";
import { useWallet } from "../../lib/wallet";
import { useToast } from "./Toast";
import { withBase } from "@/lib/basePath";

const WORDS = ["", "One step", "Two steps", "Three steps"];
const SWAP_XLM = "1000";

export function FaucetTab({ onConnect, onGoBaskets }: { onConnect: () => void; onGoBaskets: () => void }) {
  const { address, sign } = useWallet();
  const { balances, refresh } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<"activate" | "trust" | "swap" | null>(null);
  const [copied, setCopied] = useState(false);
  // Optimistic: Horizon can take a moment to show a line that was just signed, and the step
  // disappearing is the confirmation the signature worked.
  const [trustDone, setTrustDone] = useState(false);
  const [quote, setQuote] = useState<string | null>(null);

  const usdc = balances?.usdc;
  const funded = usdc !== undefined && usdc > 0n;
  // Unknown until the read answers, and "unknown" reads as done: flashing a step at somebody
  // whose account has been set up for months is worse than a step appearing a beat late.
  const activated = !address || balances === null || balances.xlm !== null;
  const trusted = !address || balances === null || trustDone || balances.trustline;
  const showActivate = !activated;
  const showTrust = !trusted;
  const steps = (showActivate ? 1 : 0) + (showTrust ? 1 : 0) + 1;

  useEffect(() => {
    quoteXlmToUsdc(SWAP_XLM)
      .then((q) => setQuote(q ? Number(q.usdc).toFixed(2) : null))
      .catch(() => setQuote(null));
  }, []);

  async function run<T>(kind: typeof busy, label: string, fn: () => Promise<T>, ok: (r: T) => { title: string; message?: string; hash?: string }) {
    if (!address) return;
    setBusy(kind);
    const id = toast.push({ type: "loading", title: label, message: kind === "activate" ? undefined : "Confirm in your wallet." });
    try {
      const r = await fn();
      const o = ok(r);
      toast.update(id, {
        type: "success",
        title: o.title,
        message: o.message,
        ...(o.hash ? { action: { label: "View tx", onClick: () => window.open(`${EXPLORER}/tx/${o.hash}`, "_blank", "noopener") } } : {}),
      });
      refresh();
    } catch (e) {
      toast.update(id, { type: "error", title: "Didn't go through", message: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(null);
    }
  }

  const activate = () =>
    run("activate", "Activating your account…", () => ensureFunded(address!), () => ({ title: "Account activated ✓", message: "Friendbot sent testnet XLM for fees." }));
  const trust = () =>
    run("trust", "Adding the USDC trustline…", () => addUsdcTrustline(address!, sign), (hash) => {
      setTrustDone(true);
      return { title: "USDC trustline added ✓", message: "Your account can hold Circle's USDC now.", hash };
    });
  const swap = () =>
    run("swap", `Swapping ${SWAP_XLM} XLM for USDC…`, () => swapXlmToUsdc(address!, sign, SWAP_XLM), (r) => ({
      title: `+${Number(r.usdc).toFixed(2)} USDC ✓`,
      message: "Pick a basket to put it to work.",
      hash: r.hash,
    }));

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const needsSetup = !address || showActivate || showTrust;

  return (
    <main className="fc-page">
      <section className="fc-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBase("/logos/usdc.svg")} alt="" className="fc-hero-mark" />
        <h1 className="fc-title">Get USDC</h1>
        <p className="fc-lead">
          Darwin on Stellar runs on the official Circle USDC, not a mock token. {steps === 1 ? "One step left" : WORDS[steps]} and
          you are funded.
        </p>
        <div className="fc-stats">
          <Stat label="Network" value="Stellar Testnet" />
          <Stat label="Asset" value="USDC by Circle" />
          <Stat
            label="Your USDC"
            value={address && usdc !== undefined ? toNum(usdc).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
          />
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

        {showTrust && (
          <StepRow
            icon={withBase("/logos/usdc.svg")}
            badge
            title="Add the USDC trustline"
            blurb={
              activated
                ? "One signature, once, lets your account hold Circle's USDC."
                : "One signature, once. Waits on the account above: a trustline needs an account to sit on."
            }
          >
            <button type="button" className="fc-btn fc-btn-ink" onClick={trust} disabled={busy !== null || !activated}>
              {busy === "trust" ? "Signing…" : "Add trustline"}
            </button>
          </StepRow>
        )}

        <StepRow
          icon={withBase("/logos/usdc.svg")}
          done={funded}
          title="Request USDC from Circle"
          blurb={
            !address
              ? "Connect your wallet first, then paste your address on Circle's faucet. 20 USDC every 2 hours."
              : "Pick USDC · Stellar Testnet, paste your address. 20 USDC every 2 hours."
          }
        >
          <div className="fc-actions">
            {address ? (
              <button type="button" className="fc-btn fc-btn-soft" onClick={copyAddress}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied!" : "Copy address"}
              </button>
            ) : (
              <button type="button" className="fc-btn fc-btn-soft" onClick={onConnect}>
                Connect wallet
              </button>
            )}
            <a href={CIRCLE_FAUCET} target="_blank" rel="noreferrer" className="fc-btn fc-btn-ink">
              faucet.circle.com
              <ExternalIcon />
            </a>
          </div>
        </StepRow>

        <StepRow
          icon={withBase("/logos/rwa/XLM.svg")}
          title="Or swap testnet XLM for USDC"
          blurb={`Friendbot XLM, swapped for Circle's USDC on the testnet XLM/USDC pool. ${SWAP_XLM} XLM ≈ ${quote ?? "…"} USDC.`}
        >
          <button type="button" className="fc-btn fc-btn-ink" onClick={swap} disabled={busy !== null || needsSetup}>
            {busy === "swap" ? "Swapping…" : `Swap ${Number(SWAP_XLM).toLocaleString("en-US")} XLM`}
          </button>
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
  badge,
  done,
  title,
  blurb,
  children,
}: {
  icon: string;
  /** A tick on the mark: the step is permission to hold the thing, not the thing. */
  badge?: boolean;
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
        <span className="fc-mark-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon} alt="" className="fc-row-mark" />
          {badge && (
            <span className="fc-badge">
              <CheckIcon />
            </span>
          )}
        </span>
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

function ExternalIcon() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
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
