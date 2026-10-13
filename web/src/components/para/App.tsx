"use client";

/**
 * The Darwin app on Stellar — the same shell as app.darwin.market: navbar on the gradient
 * (Baskets / Portfolio / Activity · network · account), cream panel below holding the hero +
 * Explore grid, and a full-screen basket view (chart, composition, trade card, other baskets).
 *
 * A basket is public: index, chart and composition owe nothing to a wallet, only the trade does.
 * Signed out, the basket screen shows the SAME trade card with "Connect wallet" as its button.
 * The open basket rides in the URL (?b=), so back/forward and a reload land on it.
 */

import { useEffect, useState } from "react";

import { BASKETS } from "../../lib/baskets";
import { useData } from "../../lib/data";
import { useWallet, type ConnectMethod } from "../../lib/wallet";
import { DarwinHome } from "../darwin/DarwinHome";
import { HeroActions, darwinContainer } from "../darwin/shell";
import { ActivityTab, TradeHistory } from "./Activity";
import { AgamaFrame } from "./AgamaFrame";
import { AgamaNavbar, NAV_ACTION_WIDTH, NavPillButton, NetworkPill, SigningInPill } from "./AgamaNavbar";
import AnimatedButton from "./AnimatedButton";
import { BasketScreen } from "./BasketScreen";
import { BUY_FEE_BPS, BasketTradePanel } from "./BasketTradePanel";
import { DepositPanel } from "./DepositPanel";
import { Overlay } from "./Overlay";
import { PortfolioTab } from "./PortfolioTab";
import { useToast } from "./Toast";
import { TradeCard } from "./TradeCard";
import { usePanelScroll } from "./usePanelScroll";

type Tab = "Baskets" | "Portfolio" | "Activity";

const short = (a: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const knownSymbol = (s: string | null) => (s && BASKETS.some((b) => b.symbol === s) ? s : null);
const nameOf = (s: string) => BASKETS.find((b) => b.symbol === s)?.name ?? s;

/* Wallet mark — any Stellar wallet through the Wallets Kit. */
function WalletIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="16.5" cy="14" r="1.35" fill="currentColor" />
    </svg>
  );
}

/* Sparkle mark — the instant demo wallet. */
function SparkIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.5l2.2 5.9a2 2 0 0 0 1.4 1.4L21.5 12l-5.9 2.2a2 2 0 0 0-1.4 1.4L12 21.5l-2.2-5.9a2 2 0 0 0-1.4-1.4L2.5 12l5.9-2.2a2 2 0 0 0 1.4-1.4L12 2.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="cx-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function App() {
  const { address, connect, disconnect, connecting } = useWallet();
  const { refresh } = useData();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("Baskets");
  const [connectOpen, setConnectOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [openSymbol, setOpenSymbol] = useState<string | null>(() =>
    typeof window === "undefined" ? null : knownSymbol(new URLSearchParams(window.location.search).get("b")),
  );

  // Keep ?b= in step with the open basket, and let back/forward drive it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("b") === (openSymbol ?? null)) return;
    if (openSymbol) url.searchParams.set("b", openSymbol);
    else url.searchParams.delete("b");
    window.history.pushState(null, "", url);
  }, [openSymbol]);
  useEffect(() => {
    const onPop = () => setOpenSymbol(knownSymbol(new URLSearchParams(window.location.search).get("b")));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  usePanelScroll(openSymbol);

  const [choosing, setChoosing] = useState<ConnectMethod | null>(null);
  async function choose(m: ConnectMethod) {
    setChoosing(m);
    try {
      await connect(m);
      setConnectOpen(false);
      refresh();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/closed|cancel|reject/i.test(msg)) toast.push({ type: "error", title: "Couldn't connect", message: msg });
    } finally {
      setChoosing(null);
    }
  }

  const right = address ? (
    // network selector + account button, stuck together on the far right
    <span style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
      <NetworkPill />
      <NavPillButton onClick={() => void disconnect()} title={address} className={`${NAV_ACTION_WIDTH} !font-mono !text-[12px]`}>
        {short(address)} ⏻
      </NavPillButton>
    </span>
  ) : (
    <>
      <NetworkPill />
      {connecting ? (
        <SigningInPill />
      ) : (
        <AnimatedButton onClick={() => setConnectOpen(true)} className={`h-10 px-[17px] text-[14px] font-medium ${NAV_ACTION_WIDTH}`}>
          Connect wallet
        </AnimatedButton>
      )}
    </>
  );

  return (
    <AgamaFrame
      nav={
        <AgamaNavbar
          tabs={["Baskets", "Portfolio", "Activity"]}
          activeTab={tab}
          onTab={(t) => {
            // Clicking Baskets while a basket is open means "back to the grid".
            if (t === "Baskets" && tab === "Baskets") setOpenSymbol(null);
            setTab(t as Tab);
          }}
          right={right}
        />
      }
    >
      {tab === "Baskets" && (
        // Kept mounted while a basket is open, so coming back restores the grid's scroll.
        <main style={openSymbol ? { ...darwinContainer, display: "none" } : darwinContainer}>
          <DarwinHome onOpen={(symbol: string) => setOpenSymbol(symbol)} actions={<HeroActions />} />
          <TradeHistory accountId={address} limit={5} onViewAll={() => setTab("Activity")} />
        </main>
      )}

      {tab === "Baskets" && openSymbol && (
        <BasketScreen symbol={openSymbol} name={nameOf(openSymbol)} onClose={() => setOpenSymbol(null)} onOpen={setOpenSymbol}>
          {address ? (
            <BasketTradePanel key={openSymbol} symbol={openSymbol} name={nameOf(openSymbol)} onDeposit={() => setDepositOpen(true)} />
          ) : (
            <PreConnectCard key={openSymbol} name={nameOf(openSymbol)} symbol={openSymbol} onConnect={() => setConnectOpen(true)} />
          )}
        </BasketScreen>
      )}

      {tab === "Portfolio" &&
        (address ? (
          <PortfolioTab
            onOpen={(s) => {
              setTab("Baskets");
              setOpenSymbol(s);
            }}
            onGoBaskets={() => setTab("Baskets")}
          />
        ) : (
          <ConnectPrompt tab="Portfolio" onConnect={() => setConnectOpen(true)} />
        ))}

      {tab === "Activity" && (address ? <ActivityTab accountId={address} /> : <ConnectPrompt tab="Activity" onConnect={() => setConnectOpen(true)} />)}

      {connectOpen && !address && (
        <Overlay onClose={() => setConnectOpen(false)}>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: "2px 0 0", letterSpacing: "-0.01em" }}>Connect</h2>
          <p style={{ marginTop: 5, fontSize: 14, color: "var(--ink-3)" }}>Choose how you&rsquo;d like to sign in.</p>

          <button type="button" onClick={() => void choose("kit")} disabled={connecting} className="cx-choice" style={{ marginTop: 18 }}>
            <span className="cx-tile cx-tile-para">
              <WalletIcon />
            </span>
            <span className="cx-body">
              <span className="cx-title" style={{ display: "block" }}>
                {connecting && choosing === "kit" ? "Waiting for your wallet…" : "Connect a Stellar wallet"}
              </span>
              <span className="cx-sub" style={{ display: "block" }}>
                Freighter, xBull, Lobstr, Albedo, Hana, Rabet…
              </span>
            </span>
            <ArrowIcon />
          </button>

          <button type="button" onClick={() => void choose("demo")} disabled={connecting} className="cx-choice">
            <span className="cx-tile cx-tile-miden">
              <SparkIcon />
            </span>
            <span className="cx-body">
              <span className="cx-title" style={{ display: "block" }}>
                {connecting && choosing === "demo" ? "Connecting…" : "Try with a demo wallet"}
              </span>
              <span className="cx-sub" style={{ display: "block" }}>
                Instant testnet account in your browser, no extension
              </span>
            </span>
            <ArrowIcon />
          </button>

          <a href="https://www.freighter.app" target="_blank" rel="noopener noreferrer" className="cx-newto">
            New to Stellar? <b>Get Freighter at freighter.app →</b>
          </a>
        </Overlay>
      )}

      {depositOpen && address && (
        <Overlay onClose={() => setDepositOpen(false)}>
          <DepositPanel onClose={() => setDepositOpen(false)} />
        </Overlay>
      )}
    </AgamaFrame>
  );
}

/**
 * The trade card before there is a wallet — the SAME card, not a placeholder: pick an amount and
 * see what it buys; only the last button needs a wallet, so nothing moves when you connect.
 */
function PreConnectCard({ symbol, name, onConnect }: { symbol: string; name: string; onConnect: () => void }) {
  const [amount, setAmount] = useState("");
  const spent = Number(amount);
  // USDC is a dollar: what the basket is worth is what you put in, less the fee.
  const net = spent > 0 ? spent * (1 - BUY_FEE_BPS / 10_000) : null;
  return (
    <TradeCard
      symbol={symbol}
      side="buy"
      onSide={() => {}}
      sellDisabled
      sellTitle="Connect a wallet to sell"
      spendLabel="You spend"
      amount={amount}
      onAmount={setAmount}
      amountUnit="USDC"
      maxDisabled
      chips={[25, 50, 100].map((v) => ({ label: `$${v}`, onClick: () => setAmount(String(v)) }))}
      receiveValue={net == null ? "$0.00" : `$${net.toFixed(2)}`}
      receiveUnit={`of ${name}`}
      fine={`Includes the ${(BUY_FEE_BPS / 100).toFixed(2)}% fee`}
      notes={
        <p style={{ marginTop: 11, fontSize: 12, lineHeight: 1.5, color: "var(--color-text-muted)" }}>
          Connect a wallet to buy. Your basket tokens stay in your own wallet.
        </p>
      }
      cta={{ label: "Connect wallet", onClick: onConnect }}
      footer={
        <p style={{ marginTop: 11, fontSize: 12, lineHeight: 1.5, color: "var(--color-text-muted)" }}>
          Settled at the basket&apos;s live net asset value, priced on-chain by Reflector when the trade is sent.
        </p>
      }
    />
  );
}

function ConnectPrompt({ tab, onConnect }: { tab: "Portfolio" | "Activity"; onConnect: () => void }) {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "clamp(60px, 14vh, 160px) 20px", textAlign: "center" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{tab}</h1>
      <p style={{ marginTop: 10, color: "var(--ink-3)" }}>
        {tab === "Portfolio" ? "Connect a wallet to see your holdings and positions." : "Connect a wallet to see your transaction activity."}
      </p>
      <span style={{ display: "inline-flex", marginTop: 22 }}>
        <AnimatedButton variant="primary" onClick={onConnect} className="h-11 px-6 text-[15px] font-medium">
          Connect wallet
        </AnimatedButton>
      </span>
    </main>
  );
}
