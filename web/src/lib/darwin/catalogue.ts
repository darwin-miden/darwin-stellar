/**
 * The baskets this block shows are the deployed ones: `BASKETS` in `lib/baskets.ts` comes from
 * deployments/testnet.json, so a redeploy moves the hero and the Explore grid with it — no second
 * list to keep in step.
 *
 * What the deployment doesn't carry is display data: which Yahoo series draws each constituent's
 * history (crypto spot, gold futures, the FX pair a stablebond is denominated in), and its value on
 * INCEPTION. That lives here, keyed by ticker.
 *
 * A bill / bond is priced exactly as the on-chain oracle prices it: reference (FX rate, or a fixed
 * USD value for dollar funds) × its yield index, `1 + apy · (t − t0) / year`.
 */

import { ASSETS, BASKETS } from "@/lib/baskets";

export type Coin = {
  symbol: string;
  name: string;
  issuer: string;
  /** Yahoo Finance series for the reference price, or null for a fixed-USD reference. */
  yahoo: string | null;
  /** Fixed USD reference (dollar funds). */
  fixedUsd?: number;
  /** Reference value on INCEPTION (Yahoo close), before accrual. */
  inceptionRef: number;
  apyBps: number;
  /** Accrual start (unix seconds), the same t0 the oracle uses. */
  t0: number;
};

export const INCEPTION = "2026-07-01";
const INCEPTION_MS = Date.parse(INCEPTION);
const YEAR_MS = 365 * 864e5;

/** Closes on 2026-07-01 (Yahoo daily). */
const SERIES: Record<string, { yahoo: string | null; inceptionRef: number; fixedUsd?: number }> = {
  BTC: { yahoo: "BTC-USD", inceptionRef: 60003.757812 },
  ETH: { yahoo: "ETH-USD", inceptionRef: 1608.960693 },
  XLM: { yahoo: "XLM-USD", inceptionRef: 0.197589 },
  GOLD: { yahoo: "GC=F", inceptionRef: 4082.399902 },
  EUTBL: { yahoo: "EURUSD=X", inceptionRef: 1.137799 },
  GILTS: { yahoo: "GBPUSD=X", inceptionRef: 1.327933 },
  CETES: { yahoo: "MXNUSD=X", inceptionRef: 0.056966 },
  TESOURO: { yahoo: "BRLUSD=X", inceptionRef: 0.191549 },
  USDY: { yahoo: null, inceptionRef: 1.1, fixedUsd: 1.1 },
  BENJI: { yahoo: null, inceptionRef: 1, fixedUsd: 1 },
  USTRY: { yahoo: null, inceptionRef: 1, fixedUsd: 1 },
};

export const COINS: Record<string, Coin> = Object.fromEntries(
  Object.values(ASSETS).map((a) => {
    const s = SERIES[a.sym] ?? { yahoo: null, inceptionRef: 1, fixedUsd: 1 };
    const t0 = (a as { t0?: number }).t0 ?? Math.floor(Date.now() / 1000);
    return [a.sym, { symbol: a.sym, name: a.name, issuer: a.issuer, apyBps: a.apyBps, t0, ...s }];
  }),
);

/** The yield index at `ms` (1 for spot assets). */
export function accrual(coin: Coin, ms: number): number {
  if (!coin.apyBps) return 1;
  return 1 + (coin.apyBps / 10_000) * ((ms - coin.t0 * 1000) / YEAR_MS);
}

/** Value of one whole token at `ms`, from its reference value then. */
export const priceAt = (coin: Coin, ref: number, ms: number) => ref * accrual(coin, ms);

export const inceptionUsd = (coin: Coin) => priceAt(coin, coin.inceptionRef, INCEPTION_MS);

export type CatalogueBasket = {
  symbol: string;
  name: string;
  description: string;
  /** Target weights in basis points, summing to 10 000. */
  constituents: { symbol: string; targetWeightBps: number }[];
  live: boolean;
};

export const CATALOGUE: CatalogueBasket[] = BASKETS.map((b) => ({
  symbol: b.symbol,
  name: b.name,
  description: b.description,
  live: true,
  constituents: b.constituents.map((c) => ({ symbol: c.sym, targetWeightBps: c.weightBps })),
}));

/** The index is 100 at inception; fixes the units each index share holds. */
export const SHARE_AT_INCEPTION = 100;

/** Index units of a constituent per share — fixed, never rebalanced. */
export function unitsPerShare(basket: CatalogueBasket, symbol: string) {
  const leg = basket.constituents.find((c) => c.symbol === symbol);
  const coin = COINS[symbol];
  if (!leg || !coin) return 0;
  return (SHARE_AT_INCEPTION * (leg.targetWeightBps / 10_000)) / inceptionUsd(coin);
}

export const catalogueBasket = (symbol: string) => CATALOGUE.find((b) => b.symbol === symbol);
