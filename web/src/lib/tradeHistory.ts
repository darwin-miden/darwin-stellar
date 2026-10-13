"use client";

/**
 * Local buy/sell history.
 *
 * The trades themselves live on-chain, but the SDK's per-account tx log isn't a friendly
 * "you bought X of Y" feed — so we keep a small human-readable activity log in localStorage,
 * keyed by account id (a fresh account starts empty; switching login shows the right history).
 * It survives reloads and is capped so it can't grow unbounded.
 *
 * This is a display convenience, NOT the source of truth — the vault balance is. If the log and
 * the balance ever disagree, the balance wins.
 */

export type TradeKind = "buy" | "sell";

export interface TradeEntry {
  ts: number; // epoch ms
  kind: TradeKind;
  symbol: string; // basket symbol, e.g. "DXTB"
  name: string; // basket display name
  amount: string; // human amount traded (USDC spent for a buy, shares/units sold for a sell)
  unit: string; // "USDC" for a buy, the basket symbol for a sell
  tx?: string; // transaction hash (links to stellar.expert)
}

const KEY_PREFIX = "darwin.history.";
const MAX_ENTRIES = 50;

function keyFor(accountId: string): string {
  return KEY_PREFIX + accountId.toLowerCase();
}

const listeners = new Set<() => void>();
// Cache per account so useSyncExternalStore's getSnapshot returns a STABLE reference between renders
// (returning a fresh array each call makes React loop with "getSnapshot should be cached").
const cache = new Map<string, TradeEntry[]>();

function read(accountId: string): TradeEntry[] {
  const cached = cache.get(accountId.toLowerCase());
  if (cached) return cached;
  let list: TradeEntry[] = [];
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(keyFor(accountId)) : null;
    if (raw) list = JSON.parse(raw) as TradeEntry[];
  } catch {
    list = [];
  }
  cache.set(accountId.toLowerCase(), list);
  return list;
}

export function getTradeHistory(accountId: string | null | undefined): TradeEntry[] {
  if (!accountId) return EMPTY;
  return read(accountId);
}

// Shared empty array so a no-account snapshot is referentially stable too.
const EMPTY: TradeEntry[] = [];

export function logTrade(accountId: string | null | undefined, entry: Omit<TradeEntry, "ts">): void {
  if (!accountId) return;
  const k = accountId.toLowerCase();
  const next = [{ ts: Date.now(), ...entry }, ...read(accountId)].slice(0, MAX_ENTRIES);
  cache.set(k, next);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(keyFor(accountId), JSON.stringify(next));
  } catch {
    /* localStorage full/unavailable — the in-memory cache still updates the UI this session */
  }
  listeners.forEach((l) => l());
}

export function subscribeTradeHistory(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
