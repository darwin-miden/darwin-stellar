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
import { useWallet } from "../../lib/wallet";
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
import { WalletMenu } from "./WalletMenu";

type Tab = "Baskets" | "Portfolio" | "Activity";

const short = (a: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
const knownSymbol = (s: string | null) => (s && BASKETS.some((b) => b.symbol === s) ? s : null);
const nameOf = (s: string) => BASKETS.find((b) => b.symbol === s)?.name ?? s;

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

  const [choosing, setChoosing] = useState<string | null>(null);
  async function choose(walletId: string) {
    setChoosing(walletId);
    try {
      await connect("kit", walletId);
      setConnectOpen(false);
      refresh();
    } catch (e) {
      const msg = String((e as Error)?.message ?? (e as { message?: string })?.message ?? e);
      if (!/closed|cancel|reject|denied|declined/i.test(msg)) toast.push({ type: "error", title: "Couldn't connect", message: msg });
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
    // The menu spans exactly the network pill + Connect wallet, right below them.
    <span className="wm-anchor">
      <NetworkPill />
      {connecting ? (
        <SigningInPill />
      ) : (
        <AnimatedButton active={connectOpen} onClick={() => setConnectOpen((o) => !o)} className={`h-10 px-[17px] text-[14px] font-medium ${NAV_ACTION_WIDTH}`}>
          Connect wallet
        </AnimatedButton>
      )}
      {connectOpen && <WalletMenu pending={choosing} onPick={(id) => void choose(id)} onClose={() => !choosing && setConnectOpen(false)} />}
    </span>
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
