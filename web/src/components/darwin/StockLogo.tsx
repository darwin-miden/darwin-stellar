"use client";

import { memo, useState, type CSSProperties } from "react";

/** Logos served locally so nothing depends on a third-party CDN: coin logos, and for the
 *  Stellar RWAs the issuing sovereign's flag (bonds / bills) or the fund's mark. */
const COIN_ICONS = new Set(["BTC", "ETH"]);
const RWA_ICONS = new Set(["XLM", "GOLD", "USDY", "BENJI", "EUTBL", "USTRY", "GILTS", "CETES", "TESOURO"]);

const logoUrl = (symbol: string) =>
  COIN_ICONS.has(symbol) ? `/logos/crypto/${symbol}.png` : RWA_ICONS.has(symbol) ? `/logos/rwa/${symbol}.svg` : "";

export const StockLogo = memo(function StockLogo({ sym, size = 22 }: { sym: string; size?: number }) {
  const symbol = sym.trim().toUpperCase();
  const src = logoUrl(symbol);
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size, borderRadius: 999 };

  if (src && failed !== src) {
    return (
      // Loaded eagerly: these sit above the fold (hero chips, tile headers) and weigh a few kB
      // each, so deferring them only made them pop in after everything else had settled.
      // eslint-disable-next-line @next/next/no-img-element -- external logo CDN, fixed tiny sizes
      <img className="slogo" src={src} alt="" width={size} height={size} onError={() => setFailed(src)} style={style} />
    );
  }
  return (
    <span aria-hidden className="slogo slogo-fb" style={{ ...style, fontSize: Math.round(0.4 * size), letterSpacing: "-0.02em" }}>
      {symbol.slice(0, 2)}
    </span>
  );
});

export const LogoStack = memo(function LogoStack({
  legs,
  size = 28,
  max = 4,
}: {
  legs: { symbol: string }[];
  size?: number;
  max?: number;
}) {
  const overlap = Math.round(0.29 * size);
  return (
    <span className="stack" style={{ "--overlap": `${overlap}px` } as CSSProperties} aria-hidden>
      {legs.slice(0, max).map((leg, i) => (
        <StockLogo key={`${leg.symbol}-${i}`} sym={leg.symbol} size={size} />
      ))}
    </span>
  );
});
