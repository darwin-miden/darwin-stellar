"use client";

/**
 * A basket, full screen: chart and composition on the left, the trade card and the other
 * baskets in a rail on the right. It is a view inside the app, not a route, so the URL is kept in
 * step with history.pushState (see App) and back behaves.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { calendarDayYear, indexLevel, usd } from "@/lib/darwin/format";
import { RANGES, useNavHistory } from "@/lib/darwin/navHistory";
import { useBaskets } from "@/lib/darwin/store";
import type { Basket, Leg, Range } from "@/lib/darwin/types";
import { Change, Chart } from "../darwin/Chart";
import { CompositionTreemap } from "../darwin/CompositionTreemap";
import { LogoStack, StockLogo } from "../darwin/StockLogo";
import { sinceLaunch } from "../darwin/sinceLaunch";
import { instrumentSans } from "../darwin/shell";
import "../darwin/darwin-ui.css";
import s from "./BasketScreen.module.css";

const byWeight = (b: Basket) => [...b.legs].sort((x, y) => y.weight - x.weight);

/*
 * THIS NUMBER IS AN INDEX, NOT A PRICE. It is the basket's fixed units priced at today's
 * market, against a base of 100 at inception — so 217.27 reads directly as "the strategy has
 * more than doubled". It is NOT what one token is backed by (vault value / supply, around a
 * dollar, read on chain by the trade card). Showing it as "NAV / share" would misquote every
 * trade by the index's distance from 1.
 *
 * Keeping them apart is what lets both be true AND useful: the index carries the track record,
 * the token stays a size you can read in your wallet.
 */
const level = indexLevel;

/** Logos + name + ticker. */
function Identity({ basket, symbol, name }: { basket?: Basket; symbol: string; name: string }) {
  return (
    <span className={s.identity}>
      {basket && <LogoStack legs={byWeight(basket)} size={42} />}
      <span className={s.names}>
        <strong>{basket?.name ?? name}</strong>
        <small>{symbol}</small>
      </span>
    </span>
  );
}

/** NAV per share and the move over the selected window. */
function Quote({ basket, change, range }: { basket?: Basket; change: number | null; range: Range }) {
  return (
    <span className={s.quote}>
      <span className={`${s.quoteValue} num`}>{basket ? level(basket.navUsd) : "—"}</span>
      <span className={s.quoteMeta}>
        <Change value={change} suffix={range} />
        <span>Index base 100 at launch</span>
      </span>
    </span>
  );
}

/** The NAV path, with its own window switch. Returns the change so the header can show it. */
function useChart(basket: Basket | undefined, initial: Range) {
  const [range, setRange] = useState<Range>(initial);
  const history = useNavHistory(basket?.legs, range);
  return { range, setRange, history };
}

function Ranges({ range, onRange }: { range: Range; onRange: (r: Range) => void }) {
  return (
    <span className={s.ranges} role="group" aria-label="Chart window">
      {RANGES.map((r) => (
        <button key={r} type="button" className={s.range} data-on={r === range || undefined} onClick={() => onRange(r)}>
          {r}
        </button>
      ))}
    </span>
  );
}

/** Treemap + one row per constituent: weight, live price, units per share. */
function CompositionCard({ basket }: { basket?: Basket }) {
  const legs = useMemo(() => (basket ? byWeight(basket) : []), [basket]);
  const tiles = useMemo(() => legs.map((l) => ({ id: l.address, symbol: l.symbol, weight: l.weight })), [legs]);
  if (!basket) return null;
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <span className={s.cardTitle}>Composition</span>
        <span className={s.cardTitle}>{legs.length} assets</span>
      </div>
      <CompositionTreemap items={tiles} compact className={s.treemap} />
      <ul className={s.legs}>
        {legs.map((l) => (
          <li key={l.address} className={s.leg}>
            <span className={s.legName}>
              <StockLogo sym={l.symbol} size={20} />
              <span>{l.symbol}</span>
            </span>
            <span className={s.legPrice}>{l.priceUsd > 0 ? usd(l.priceUsd) : "—"}</span>
            <span className={`${s.legWeight} num`}>{(100 * l.weight).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Flat facts: what the basket is made of and how it has done since its units were fixed. */
function Facts({ basket }: { basket?: Basket }) {
  if (!basket) return null;
  const launch = sinceLaunch(basket);
  return (
    <div className={s.facts}>
      <div className={s.fact}>
        <span className={s.factLabel}>Index</span>
        <span className={`${s.factValue} num`}>{level(basket.navUsd)}</span>
      </div>
      <div className={s.fact}>
        <span className={s.factLabel}>Since launch</span>
        <span className={s.factValue}>
          <Change value={launch} />
        </span>
      </div>
      <div className={s.fact}>
        <span className={s.factLabel}>Assets</span>
        <span className={s.factValue}>{basket.legs.length}</span>
      </div>
      <div className={s.fact}>
        <span className={s.factLabel}>Inception</span>
        <span className={s.factValue}>{basket.inception ? calendarDayYear(Date.parse(basket.inception)) : "—"}</span>
      </div>
    </div>
  );
}


/* ── the other baskets, in the rail under the trade card ─────────────────────────────────── */

/** Cached by the Explore grid on the same page, so every row's 30-day move is free. */
function Move30d({ legs }: { legs: Leg[] }) {
  const history = useNavHistory(legs, "30D");
  return <Change value={history.change} />;
}

/** The live baskets other than the one on screen. */
const others = (baskets: Basket[] | undefined, symbol: string) =>
  (baskets ?? []).filter((b) => b.symbol !== symbol && b.live !== false);

function OtherBaskets({ baskets, symbol, onOpen }: { baskets?: Basket[]; symbol: string; onOpen: (s: string) => void }) {
  const list = others(baskets, symbol);
  if (list.length === 0) return null;
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <span className={s.cardTitle}>Other baskets</span>
      </div>
      <div className={s.railList}>
        {list.map((b) => (
          <button key={b.address} type="button" className={s.railRow} onClick={() => onOpen(b.symbol)}>
            <LogoStack legs={byWeight(b)} size={24} />
            <span className={s.railName}>
              <strong>{b.name}</strong>
              <small>{b.symbol}</small>
            </span>
            <span className={s.railValue}>
              <strong>{level(b.navUsd)}</strong>
              <small>
                <Move30d legs={b.legs} />
              </small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function BasketScreen({
  symbol,
  name,
  hidden = false,
  onClose,
  onOpen,
  children,
}: {
  symbol: string;
  name: string;
  hidden?: boolean;
  onClose: () => void;
  /** Switch to another basket without going back to the grid. */
  onOpen?: (symbol: string) => void;
  /** The trade panel — mounted once and kept alive across closes. */
  children: ReactNode;
}) {
  const { data: baskets } = useBaskets();
  const basket = useMemo(() => baskets?.find((b) => b.symbol === symbol), [baskets, symbol]);
  const { range, setRange, history } = useChart(basket, "30D");
  const rootRef = useRef<HTMLDivElement>(null);

  // Esc goes back to the grid, like the dialog it replaced.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hidden]);

  // Hidden-but-mounted must also leave the focus and accessibility trees, or a control inside a
  // display:none subtree keeps focus (the warning Overlay documents).
  useEffect(() => {
    if (rootRef.current) rootRef.current.inert = hidden;
  }, [hidden]);

  // Scrolling on a basket change is owned by usePanelScroll in the shell, which knows the one
  // scroller and also remembers where the grid was. This only has to say which basket is next.
  const switchTo = (next: string) => onOpen?.(next);

  return (
    <div ref={rootRef} className={`darwin-ui ${instrumentSans.variable}`} style={hidden ? { display: "none" } : undefined}>
      <div className={s.page}>
        <button type="button" className={s.back} onClick={onClose}>
          ← All baskets
        </button>
        <div className={s.pageHead}>
          <div style={{ minWidth: 0 }}>
            <Identity basket={basket} symbol={symbol} name={name} />
            {basket?.description && <p className={s.tagline}>{basket.description}</p>}
          </div>
          <Quote basket={basket} change={history.change} range={range} />
        </div>
        <div className={s.grid}>
          <div className={s.column}>
            <section className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardTitle}>Index</span>
                <Ranges range={range} onRange={setRange} />
              </div>
              <Chart history={history} height={300} grid axis />
            </section>
            <Facts basket={basket} />
            <p className={s.footnote}>
              The index prices the basket&apos;s fixed units at published market rates, from a base of
              100 on {basket?.inception ? calendarDayYear(Date.parse(basket.inception)) : "inception"}.
              It is a simulation at constant weights, not realised performance, and it is not the price
              of one token — what a token is backed by is shown in the trade card.
            </p>
            <CompositionCard basket={basket} />
          </div>
          <aside className={s.rail}>
            <section className={s.card}>{children}</section>
            {onOpen && <OtherBaskets baskets={baskets} symbol={symbol} onOpen={switchTo} />}
          </aside>
        </div>
      </div>
    </div>
  );
}
