export type AssetClass = "crypto";

export type Quote = "USDC";

/** A tokenized asset that can be added to a basket. */
export type Asset = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  class: AssetClass;
  priceUsd: number;
  /** Liquidity available on the USDC route. */
  depthUsd: number;
  /** Last oracle update (unix seconds). */
  updatedAt?: number;
};

/** One constituent of a basket: a fixed number of units per basket share. */
export type Leg = {
  address: string;
  symbol: string;
  decimals: number;
  class: AssetClass;
  perShare: number;
  priceUsd: number;
  valueUsd: number;
  /** Share of NAV at current prices (0..1). */
  weight: number;
  /** Weight the basket was built with, before prices moved it. */
  targetWeight?: number;
  depthUsd: number;
};

export type Basket = {
  address: string;
  symbol: string;
  name: string;
  description?: string;
  owner: string;
  /** Deployment time (unix seconds). */
  createdAt?: number;
  supplyFloat: number;
  paused: boolean;
  mintFeeBps: number;
  redeemFeeBps: number;
  protocolMintFeeBps: number;
  protocolRedeemFeeBps: number;
  navUsd: number;
  tvlUsd: number;
  /** Trade size at ~1% price impact, limited by the thinnest route. */
  capacityUsd: number;
  /** Price of one share through the router, fees and impact included. */
  costPerShareUsd: number;
  quote: Quote;
  /** Shares that can still be minted / redeemed this hour, when the vault throttles flows. */
  issuanceAvailable?: number;
  redemptionAvailable?: number;
  legs: Leg[];
  /** Tradable today; the others are priced but not yet open. */
  live?: boolean;
  /** ISO date the fixed units were set, and the share value on that day. */
  inception?: string;
  shareAtInception?: number;
};

export type Position = Basket & {
  balanceFloat: number;
  valueUsd: number;
};

export type Range = "7D" | "30D" | "90D" | "1Y";

export type NavHistory = {
  points: [number, number][];
  change: number | null;
  supported: boolean;
  loading: boolean;
};
