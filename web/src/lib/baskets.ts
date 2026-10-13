import { DEPLOYMENT } from "./config";

export interface BasketConstituent {
  readonly sym: string;
  readonly token: string;
  readonly weightBps: number;
  readonly units: string;
}

export interface Basket {
  readonly name: string;
  readonly symbol: string;
  readonly description: string;
  readonly vault: string;
  readonly shares: string;
  readonly constituents: readonly BasketConstituent[];
}

export interface Asset {
  readonly sym: string;
  readonly name: string;
  readonly issuer: string;
  readonly kind: string;
  readonly apyBps: number;
  readonly id: string;
}

export const BASKETS: readonly Basket[] = DEPLOYMENT.baskets;
export const ASSETS: Record<string, Asset> = DEPLOYMENT.assets as Record<string, Asset>;

export function basketBySymbol(symbol: string): Basket | undefined {
  return BASKETS.find((b) => b.symbol === symbol);
}
