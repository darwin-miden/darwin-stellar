"use client";

/**
 * Portfolio tab — the user's basket holdings valued at live on-chain NAV.
 * Holding value = tokens × NAV per token (the vault's holdings × Reflector prices, read from the
 * basket's `nav()`), cash = the wallet's USDC. Same layout as app.darwin.market: total value
 * hero, one allocation bar, holdings list with the cash row last.
 */

import { CSSProperties, useMemo } from "react";

import { BASKETS, type Basket } from "../../lib/baskets";
import { toNum, useData } from "../../lib/data";
import { assetColor } from "../../lib/darwin/assetColor";

const MONO = "var(--font-mono-stack)";

const labelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--ink-3)",
};

// A basket's accent = its heaviest constituent's swatch — so the allocation bar reads as
// "which asset am I most exposed to" rather than an arbitrary palette.
function basketAccent(b: Basket): string {
  if (b.constituents.length === 0) return "var(--ink-3)";
  const dom = [...b.constituents].sort((a, c) => c.weightBps - a.weightBps)[0];
  return assetColor(dom.sym);
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// undefined = still loading · null = read failed · number = valued
type ValueMap = Record<string, number | null>;


// A shimmer placeholder — cleaner than streaming "…" while a value loads.
function Skel({ w, h = 14, radius = 6 }: { w: number | string; h?: number; radius?: number }) {
  return <span className="pf-skel" aria-hidden style={{ width: w, height: h, borderRadius: radius }} />;
}


export function PortfolioTab({
  onOpen,
  onGoBaskets,
}: {
  onOpen: (symbol: string) => void;
  onGoBaskets: () => void;
}) {
  const { navs, balances } = useData();
  const shares = balances?.shares ?? null;
  const cash = balances ? toNum(balances.usdc) : 0;
  const cashLoading = balances == null;
  const values: ValueMap = useMemo(() => {
    const out: ValueMap = {};
    for (const b of BASKETS) {
      const s = shares?.[b.symbol];
      if (s == null || s <= 0n) continue;
      const n = navs[b.symbol];
      if (n) out[b.symbol] = toNum(s) * toNum(n.navPerShare);
    }
    return out;
  }, [navs, shares]);

  const held = useMemo(() => BASKETS.filter((b) => shares && (shares[b.symbol] ?? 0n) > 0n), [shares]);
  const investedKnown = held.reduce((sum, b) => {
    const v = values[b.symbol];
    return sum + (typeof v === "number" ? v : 0);
  }, 0);
  const total = cash + investedKnown;
  const anyLoading = held.some((b) => values[b.symbol] === undefined);
  const loading = shares == null || cashLoading || (held.length > 0 && anyLoading);

  return (
    <main style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(28px, 5vh, 56px) clamp(20px, 4vw, 40px)" }}>
      {/* HERO — total portfolio value */}
      <div style={labelStyle}>Portfolio value</div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: "clamp(34px, 7vw, 48px)",
          fontWeight: 650,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          marginTop: 4,
          color: "var(--ink)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {loading ? <Skel w={190} h={44} radius={10} /> : fmtUsd(total)}
      </div>
      {/* invested/cash split is redundant with the allocation bar + the Cash holding row — omitted. */}

      {/* SIGNATURE — one allocation bar for the whole portfolio. Skeleton until the values resolve,
          so it never flickers a wrong split (e.g. a false "100% cash" while baskets are held). */}
      {loading ? (
        <div style={{ marginTop: 24 }}>
          <Skel w="100%" h={14} radius={999} />
          <div style={{ marginTop: 12, display: "flex", gap: 18 }}>
            <Skel w={72} h={12} />
            <Skel w={72} h={12} />
            <Skel w={72} h={12} />
          </div>
        </div>
      ) : (
        total > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "var(--rule-2)", gap: 2 }}>
            {held.map((b) => {
              const v = values[b.symbol];
              if (typeof v !== "number" || v <= 0) return null;
              return (
                <div
                  key={b.symbol}
                  title={`${b.name} · ${fmtUsd(v)}`}
                  style={{ width: `${(v / total) * 100}%`, background: basketAccent(b) }}
                />
              );
            })}
            {cash > 0 && <div title={`Cash · ${fmtUsd(cash)}`} style={{ width: `${(cash / total) * 100}%`, background: "var(--green)" }} />}
          </div>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
            {held.map((b) => {
              const v = values[b.symbol];
              if (typeof v !== "number" || v <= 0) return null;
              return <LegendDot key={b.symbol} color={basketAccent(b)} label={b.name} pct={(v / total) * 100} />;
            })}
            {cash > 0 && <LegendDot color="var(--green)" label="Cash" pct={(cash / total) * 100} />}
          </div>
        </div>
        )
      )}

      {/* HOLDINGS */}
      <section style={{ marginTop: "clamp(28px, 5vh, 44px)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 14px" }}>Holdings</h2>

        {shares == null ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)" }}>Loading your holdings…</p>
        ) : held.length === 0 ? (
          <div style={{ border: "1px solid var(--rule)", borderRadius: 12, padding: "28px 20px", textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 15, color: "var(--ink-2)" }}>You&apos;re all in cash — pick a basket to get started.</p>
            <button type="button" className="nav-cta" onClick={onGoBaskets} style={{ marginTop: 16, cursor: "pointer" }}>
              Browse baskets
            </button>
          </div>
        ) : (
          <div style={{ border: "1px solid var(--rule)", borderRadius: 12, overflow: "hidden" }}>
            {held.map((b, i) => {
              const v = values[b.symbol];
              const pct = total > 0 && typeof v === "number" ? (v / total) * 100 : null;
              return <HoldingRow key={b.symbol} basket={b} sharesBase={shares[b.symbol] ?? 0n} value={v} pct={pct} first={i === 0} onOpen={onOpen} />;
            })}
            {/* Cash — the uninvested USDC, shown as the last holding so the list is the whole
                portfolio. % is hidden until the basket values resolve, so it's never misleading. */}
            <CashRow cash={cash} pct={!anyLoading && total > 0 ? (cash / total) * 100 : null} />
          </div>
        )}
      </section>
    </main>
  );
}

/** The uninvested-cash row at the bottom of Holdings — same layout as a basket row, green swatch. */
function CashRow({ cash, pct }: { cash: number; pct: number | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderTop: "1px solid var(--rule)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
        <div aria-hidden style={{ width: 40, height: 8, borderRadius: 999, background: "var(--green)", flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Cash</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: "var(--ink-3)", letterSpacing: "0.04em" }}>USDC</div>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
          {fmtUsd(cash)}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {pct != null ? `${pct.toFixed(1)}%` : ""}
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: MONO, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
    </span>
  );
}

function HoldingRow({
  basket,
  sharesBase,
  value,
  pct,
  first,
  onOpen,
}: {
  basket: Basket;
  sharesBase: bigint;
  value: number | null | undefined;
  pct: number | null;
  first: boolean;
  onOpen: (symbol: string) => void;
}) {
  const dec = 7;
  const sharesNum = Number(sharesBase) / 10 ** dec;
  const sharesStr = sharesNum.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const legs = basket.constituents.map((c) => ({ color: assetColor(c.sym), pct: Math.round(c.weightBps / 100) }));
  return (
    <div
      className="holding-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(basket.symbol)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(basket.symbol);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderTop: first ? "none" : "1px solid var(--rule)",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
        {/* mini composition bar — same language as the basket cards */}
        <div
          aria-hidden
          style={{ width: 40, height: 8, display: "flex", borderRadius: 999, overflow: "hidden", background: "var(--rule-2)", flexShrink: 0 }}
        >
          {legs.map((l, i) => (
            <div key={i} style={{ width: `${l.pct}%`, background: l.color }} />
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{basket.name}</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: "var(--ink-3)", letterSpacing: "0.04em" }}>{basket.symbol}</div>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
          {value === undefined ? <Skel w={56} h={15} /> : value === null ? "—" : fmtUsd(value)}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {sharesStr} {basket.symbol}
          {pct != null ? ` · ${pct.toFixed(1)}%` : ""}
        </div>
      </div>
    </div>
  );
}
