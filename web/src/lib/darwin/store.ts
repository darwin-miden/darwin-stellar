"use client";

/**
 * Baskets for the hero, the Explore grid and the basket screen, built from the catalogue and
 * the constituents' spot prices read ON-CHAIN: each basket's `nav()` returns the Darwin oracle's
 * price for every leg (Reflector crypto / FX / gold × the instrument's yield index). Units per
 * index share are fixed at inception, so the index is just those units priced at spot and the
 * weights drift with the market.
 */

import { useMemo } from "react";

import { BASKETS } from "@/lib/baskets";
import { loadNavs, priceNum, toNum, useNavs, type BasketNav } from "@/lib/data";
import { CATALOGUE, COINS, INCEPTION, SHARE_AT_INCEPTION, unitsPerShare, type CatalogueBasket } from "./catalogue";
import type { Basket, Leg } from "./types";

type Prices = Record<string, number>;

/** One price per constituent symbol, from whichever basket holds it. */
function spotPrices(navs: Record<string, BasketNav>): Prices {
  const out: Prices = {};
  for (const b of BASKETS) {
    const n = navs[b.symbol];
    if (!n) continue;
    b.constituents.forEach((c, i) => {
      if (n.prices[i] != null) out[c.sym] = priceNum(n.prices[i]);
    });
  }
  return out;
}

/** Kicks the on-chain read early (loading fallback); the query dedupes it. */
let warmed: Promise<unknown> | null = null;
export function warmPrices(): Promise<unknown> {
  if (!warmed) {
    warmed = loadNavs().catch(() => {
      warmed = null;
    });
  }
  return warmed;
}

function toBasket(entry: CatalogueBasket, prices: Prices, nav: BasketNav | undefined): Basket {
  const priced = entry.constituents.map((c) => {
    const perShare = unitsPerShare(entry, c.symbol);
    const priceUsd = prices[c.symbol] ?? 0;
    return { ...c, perShare, priceUsd, valueUsd: perShare * priceUsd };
  });
  const navUsd = priced.reduce((sum, c) => sum + c.valueUsd, 0);

  const legs: Leg[] = priced.map((c) => ({
    address: c.symbol.toLowerCase(),
    symbol: c.symbol,
    decimals: 12,
    class: "crypto",
    perShare: c.perShare,
    priceUsd: c.priceUsd,
    valueUsd: c.valueUsd,
    weight: navUsd > 0 ? c.valueUsd / navUsd : c.targetWeightBps / 10_000,
    targetWeight: c.targetWeightBps / 10_000,
    depthUsd: 0,
  }));

  return {
    address: entry.symbol.toLowerCase(),
    symbol: entry.symbol,
    name: entry.name,
    description: entry.description,
    owner: "darwin",
    supplyFloat: nav ? toNum(nav.supply) : 0,
    paused: false,
    mintFeeBps: 0,
    redeemFeeBps: 0,
    protocolMintFeeBps: 30,
    protocolRedeemFeeBps: 20,
    navUsd,
    tvlUsd: nav ? toNum(nav.tvl) : 0,
    capacityUsd: 0,
    costPerShareUsd: nav ? toNum(nav.navPerShare) : 0,
    quote: "USDC",
    legs,
    live: entry.live,
    inception: INCEPTION,
    shareAtInception: SHARE_AT_INCEPTION,
  };
}

export { COINS };

export function useBaskets() {
  const { data: navs, error } = useNavs();
  const baskets = useMemo(() => {
    if (!navs) return undefined;
    const prices = spotPrices(navs);
    return CATALOGUE.map((entry) => toBasket(entry, prices, navs[entry.symbol]));
  }, [navs]);
  return { data: baskets, error: error && !baskets ? "Couldn't read the baskets from Stellar. Retrying…" : null };
}
