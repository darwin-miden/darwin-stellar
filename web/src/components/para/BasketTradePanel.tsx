"use client";

/**
 * Buy / sell one basket, drawn by the shared TradeCard. A buy is ONE Soroban transaction:
 * USDC in → the vault buys every constituent on the market at the Reflector price → basket
 * tokens minted to you. A sell burns tokens and returns USDC from your pro-rata slice of every
 * leg. Estimates are exact dry-runs of the same call (simulation); the submitted call carries a
 * 1% slippage floor. Settles in one ledger (~5s), so there is no queue and no claim step.
 */

import { useEffect, useState } from "react";

import { basketBySymbol } from "../../lib/baskets";
import { EXPLORER } from "../../lib/config";
import { formatUnits, parseUnits, toNum, useData } from "../../lib/data";
import { balanceShort } from "../../lib/darwin/format";
import { addr, i128, simulateAs, write } from "../../lib/stellar";
import { logTrade } from "../../lib/tradeHistory";
import { useWallet } from "../../lib/wallet";
import { useToast } from "./Toast";
import { TradeCard } from "./TradeCard";
import tc from "./TradeCard.module.css";

const SLIPPAGE_BPS = 100n;
export const BUY_FEE_BPS = 30;
export const SELL_FEE_BPS = 20;

/** Debounced dry-run of the real call: the exact amount the chain would return right now. */
function useQuote(fn: (() => Promise<bigint>) | null, key: string): { value: bigint | null; error: string | null } {
  const [value, setValue] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(null);
    setError(null);
    if (!fn) return;
    let alive = true;
    const t = setTimeout(() => {
      fn()
        .then((v) => alive && setValue(BigInt(v)))
        .catch((e) => alive && setError(String(e?.message ?? e)));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { value, error };
}

export function BasketTradePanel({ symbol, name, onDeposit }: { symbol: string; name: string; onDeposit?: () => void }) {
  const basket = basketBySymbol(symbol)!;
  const { address, sign } = useWallet();
  const { navs, balances, refresh } = useData();
  const toast = useToast();
  const nav = navs[symbol];

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [buyAmount, setBuyAmount] = useState("");
  const [sellAmount, setSellAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const buying = side === "buy";
  const usdc = balances?.usdc ?? null;
  const shares = balances?.shares[symbol] ?? null;
  const balLoading = balances == null;
  const buyBase = parseUnits(buyAmount);
  const sellBase = parseUnits(sellAmount);
  const buyOver = usdc != null && buyBase > usdc;
  const sellOver = shares != null && sellBase > shares;
  const noFunds = usdc != null && usdc === 0n;
  const holdsShares = shares != null && shares > 0n;
  const navPerShare = nav ? toNum(nav.navPerShare) : null;

  // A sell with nothing left to sell flips back to the buy side.
  useEffect(() => {
    if (!holdsShares && side === "sell" && !busy) setSide("buy");
  }, [holdsShares, side, busy]);

  const buyQuote = useQuote(
    address && buyBase > 0n && !buyOver
      ? () => simulateAs<bigint>(address, basket.vault, "buy", [addr(address), i128(buyBase), i128(0n)])
      : null,
    `${address}:${symbol}:buy:${buyBase}:${buyOver}`,
  );
  const sellQuote = useQuote(
    address && sellBase > 0n && !sellOver
      ? () => simulateAs<bigint>(address, basket.vault, "sell", [addr(address), i128(sellBase), i128(0n)])
      : null,
    `${address}:${symbol}:sell:${sellBase}:${sellOver}`,
  );

  async function trade() {
    if (!address) return;
    const kind = side;
    const amount = kind === "buy" ? buyBase : sellBase;
    const quote = kind === "buy" ? buyQuote.value : sellQuote.value;
    const min = quote != null ? (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n : 0n;
    setBusy(true);
    const id = toast.push({
      type: "loading",
      title: kind === "buy" ? `Buying ${name}…` : `Selling ${name}…`,
      message: "Confirm in your wallet. Settles in one Stellar ledger (~5s).",
    });
    try {
      const r = await write<bigint>(address, sign, basket.vault, kind, [addr(address), i128(amount), i128(min)]);
      const got = BigInt(r.value);
      toast.update(id, {
        type: "success",
        title: kind === "buy" ? `Bought ${balanceShort(toNum(got))} ${symbol} ✓` : `Sold for ${formatUnits(got, 7, 2)} USDC ✓`,
        message: kind === "buy" ? `${basket.constituents.length} assets bought in one transaction.` : "USDC is back in your wallet.",
        action: { label: "View tx", onClick: () => window.open(`${EXPLORER}/tx/${r.hash}`, "_blank", "noopener") },
      });
      logTrade(address, {
        kind,
        symbol,
        name,
        amount: kind === "buy" ? formatUnits(amount, 7, 2) : balanceShort(toNum(amount)),
        unit: kind === "buy" ? "USDC" : symbol,
        tx: r.hash,
      });
      if (kind === "buy") setBuyAmount("");
      else setSellAmount("");
      refresh();
    } catch (e) {
      toast.update(id, { type: "error", title: kind === "buy" ? "Buy failed" : "Sell failed", message: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  const maxBuy = usdc != null ? formatUnits(usdc) : null;
  const maxSell = shares != null ? formatUnits(shares) : null;
  const quickBuy = [25, 50, 100].filter((v) => maxBuy != null && v <= Number(maxBuy));
  const over = buying ? buyOver : sellOver;
  const needsFunds = buying && !balLoading && noFunds;
  const setAmount = buying ? setBuyAmount : setSellAmount;
  const holdingUsd = holdsShares && navPerShare != null ? toNum(shares as bigint) * navPerShare : null;

  // What you get, in dollars: tokens × NAV for a buy, the USDC itself for a sell.
  const quote = buying ? buyQuote : sellQuote;
  const outUsd =
    quote.value != null ? (buying ? (navPerShare != null ? toNum(quote.value) * navPerShare : null) : toNum(quote.value)) : null;
  const feeBps = buying ? BUY_FEE_BPS : SELL_FEE_BPS;

  const ctaDisabled = busy || balLoading || over || (buying ? buyBase <= 0n : sellBase <= 0n);
  const cta = needsFunds
    ? { label: "Add funds", onClick: () => onDeposit?.(), disabled: !onDeposit }
    : { label: busy ? (buying ? "Buying…" : "Selling…") : `${buying ? "Buy" : "Sell"} ${symbol}`, onClick: trade, disabled: ctaDisabled };

  return (
    <TradeCard
      symbol={symbol}
      side={side}
      onSide={setSide}
      sellDisabled={!holdsShares}
      sellTitle={holdsShares ? undefined : `You don't hold any ${symbol} yet`}
      position={
        holdsShares
          ? holdingUsd != null
            ? { value: `$${holdingUsd.toFixed(2)}`, sub: `${balanceShort(toNum(shares as bigint))} ${symbol}` }
            : { value: `${balanceShort(toNum(shares as bigint))} ${symbol}` }
          : null
      }
      spendLabel={buying ? "You spend" : "You sell"}
      amount={buying ? buyAmount : sellAmount}
      onAmount={setAmount}
      amountUnit={buying ? "USDC" : symbol}
      amountDisabled={buying && noFunds}
      onMax={() => {
        const m = buying ? maxBuy : maxSell;
        if (m != null) setAmount(m);
      }}
      maxDisabled={buying ? noFunds || balLoading : !holdsShares}
      over={over}
      chips={
        buying
          ? [
              ...quickBuy.map((v) => ({ label: `$${v}`, onClick: () => setAmount(String(v)) })),
              { label: "Max", disabled: maxBuy == null || Number(maxBuy) <= 0, onClick: () => maxBuy != null && setAmount(maxBuy) },
            ]
          : [25, 50, 100].map((pc) => ({
              label: `${pc}%`,
              disabled: !holdsShares,
              // Off the BASE units, so "100%" is exactly the balance.
              onClick: () => shares != null && setSellAmount(formatUnits((shares * BigInt(pc)) / 100n)),
            }))
      }
      available={
        buying
          ? `${usdc == null ? "…" : balanceShort(toNum(usdc))} USDC`
          : `${shares == null ? "…" : balanceShort(toNum(shares))} ${symbol}`
      }
      receiveValue={outUsd == null ? "$0.00" : `$${outUsd.toFixed(2)}`}
      receiveUnit={buying ? `of ${name}` : "USDC"}
      fine={
        quote.value != null
          ? buying
            ? `≈ ${balanceShort(toNum(quote.value))} ${symbol} after the ${(feeBps / 100).toFixed(2)}% fee`
            : `≈ ${formatUnits(quote.value, 7, 2)} USDC after the ${(feeBps / 100).toFixed(2)}% fee`
          : `Includes the ${(feeBps / 100).toFixed(2)}% fee`
      }
      warn={over ? (buying ? "Amount exceeds your USDC balance." : `Amount exceeds your ${symbol} balance.`) : (quote.error ?? null)}
      notes={
        <>
          {balLoading && <p className={tc.note}>Loading your balance…</p>}
          {needsFunds && <p className={tc.note}>You hold no USDC yet, and that is what buys a basket. The Faucet tab gets you real Circle USDC in a minute.</p>}
        </>
      }
      cta={cta}
      footer={
        <p className={tc.note}>
          Settled at the basket&apos;s live net asset value
          {navPerShare != null ? ` ($${navPerShare.toFixed(4)} per ${symbol})` : ""}, priced on-chain by Reflector when the trade is sent.
        </p>
      }
    />
  );
}
