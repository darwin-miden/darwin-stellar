"use client";

/**
 * Live on-chain state, shared by every screen: each basket's `nav()` (NAV per share, TVL, supply,
 * oracle prices, live weights) and, once connected, the user's USDC / share / XLM balances.
 * Everything is a free Soroban simulation; prices come from Reflector through the Darwin oracle.
 */

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { BASKETS } from "./baskets";
import { accountState, addr, read, type AccountState } from "./stellar";
import { useWallet } from "./wallet";

export interface BasketNav {
  navPerShare: bigint; // USDC base units per whole share
  tvl: bigint;
  supply: bigint;
  prices: bigint[]; // USD × 1e14 per whole token, constituent order
  holdings: bigint[];
  weightsBps: number[];
}

interface RawNav {
  nav_per_share: bigint;
  tvl: bigint;
  supply: bigint;
  prices: bigint[];
  holdings: bigint[];
  weights_bps: number[];
}

export interface Balances {
  /** Circle USDC (0 when there is no trustline yet). */
  usdc: bigint;
  /** null = the account doesn't exist on testnet yet. */
  xlm: number | null;
  trustline: boolean;
  shares: Record<string, bigint>;
}

export async function loadNavs(): Promise<Record<string, BasketNav>> {
  const rows = await Promise.all(
    BASKETS.map(async (b) => {
      const n = await read<RawNav>(b.vault, "nav");
      return [
        b.symbol,
        {
          navPerShare: BigInt(n.nav_per_share),
          tvl: BigInt(n.tvl),
          supply: BigInt(n.supply),
          prices: n.prices.map(BigInt),
          holdings: n.holdings.map(BigInt),
          weightsBps: n.weights_bps.map(Number),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(rows) as Record<string, BasketNav>;
}

async function loadBalances(user: string): Promise<Balances> {
  // USDC comes from Horizon: Circle's contract errors (instead of 0) on an account with no trustline.
  const [acct, ...shares] = await Promise.all([
    accountState(user),
    ...BASKETS.map((b) => read<bigint>(b.shares, "balance", [addr(user)])),
  ]);
  const a = acct as AccountState;
  return {
    usdc: a.usdc ?? 0n,
    xlm: a.exists ? a.xlm : null,
    trustline: a.usdc !== null,
    shares: Object.fromEntries(BASKETS.map((b, i) => [b.symbol, BigInt(shares[i] as bigint)])),
  };
}

const EMPTY_NAVS: Record<string, BasketNav> = {};
const NAVS_KEY = ["darwin", "navs"] as const;

/** Every basket's on-chain `nav()`, shared by every screen (one query, refreshed every 30s). */
export function useNavs() {
  return useQuery({ queryKey: NAVS_KEY, queryFn: loadNavs, refetchInterval: 30_000, staleTime: 15_000 });
}

/** Start the nav read before the app chunk mounts; the query adopts the cached result. */
export function prefetchNavs(qc: ReturnType<typeof useQueryClient>) {
  return qc.prefetchQuery({ queryKey: NAVS_KEY, queryFn: loadNavs, staleTime: 15_000 });
}

interface DataState {
  navs: Record<string, BasketNav>;
  navError: string | null;
  balances: Balances | null;
  refresh: () => void;
}

/** Navs + the connected wallet's balances, and one `refresh` after a trade. */
export function useData(): DataState {
  const { address } = useWallet();
  const qc = useQueryClient();
  const navs = useNavs();
  const balances = useQuery({
    queryKey: ["darwin", "balances", address],
    queryFn: () => loadBalances(address as string),
    enabled: !!address,
    refetchInterval: 30_000,
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["darwin"] });
  }, [qc]);
  return useMemo(
    () => ({
      navs: navs.data ?? EMPTY_NAVS,
      navError: navs.error && !navs.data ? String((navs.error as Error).message ?? navs.error) : null,
      balances: address ? (balances.data ?? null) : null,
      refresh,
    }),
    [navs.data, navs.error, balances.data, address, refresh],
  );
}

// ── formatting ────────────────────────────────────────────────────────────────────────────

/** 7-dec base units → number. */
export const toNum = (base: bigint, dec = 7) => Number(base) / 10 ** dec;
/** Oracle price (1e14) → USD number. */
export const priceNum = (p: bigint) => Number(p) / 1e14;

export function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPrice(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: p < 10 ? 4 : p < 1000 ? 2 : 0 })}`;
}

/** Human decimal string → 7-dec base units (truncating). */
export function parseUnits(s: string, dec = 7): bigint {
  if (!s || !/^\d*\.?\d*$/.test(s)) return 0n;
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
}

export function formatUnits(v: bigint, dec = 7, maxFrac = dec): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const w = a / 10n ** BigInt(dec);
  let f = (a % 10n ** BigInt(dec)).toString().padStart(dec, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${w}${f ? "." + f : ""}`;
}
