"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LogoStack } from "./StockLogo";
import { indexLevel } from "@/lib/darwin/format";
import { useNavHistory } from "@/lib/darwin/navHistory";
import type { Basket } from "@/lib/darwin/types";
import { BasketLink } from "./BasketLink";
import { HeroShader } from "./HeroShader";
import { sinceLaunch } from "./sinceLaunch";
import styles from "./Hero.module.css";

/** A basket shortcut: logos, NAV, 30-day move and whether it can be bought yet. */
function BasketChip({ basket, onOpen }: { basket: Basket; onOpen?: (symbol: string) => void }) {
  const history = useNavHistory(basket.legs, "30D");
  const legs = useMemo(() => [...basket.legs].sort((a, b) => b.weight - a.weight), [basket.legs]);

  return (
    <BasketLink
      basket={basket}
      onOpen={onOpen}
      className={styles.chip}
      ariaLabel={`Open ${basket.name}, ${basket.symbol}. Index ${indexLevel(basket.navUsd)}.`}
    >
      <span className={styles.identity}>
        <LogoStack legs={legs} size={26} />
        <span className={styles.name}>
          <strong>{basket.name}</strong>
          <small>{basket.symbol}</small>
        </span>
      </span>
      <span className={styles.values}>
        <span className={`${styles.nav} num`}>{indexLevel(basket.navUsd)}</span>
        {history.change === null ? (
          <span className={styles.pending} aria-hidden />
        ) : (
          <span className={styles.change}>
            {history.change >= 0 ? "+" : ""}
            {(100 * history.change).toFixed(2)}% 30d
          </span>
        )}
      </span>
      <span className={styles.meta}>{legs.length} assets</span>
    </BasketLink>
  );
}

/** The hero's light-on-gradient button, for calls to action passed in from the app shell. */
export const heroSecondary = styles.secondary;

/** Home hero: the pitch, the two calls to action, and a shortcut into every basket. */
export function Hero({
  baskets,
  onOpen,
  actions,
  shader = true,
}: {
  baskets: Basket[] | undefined;
  onOpen?: (symbol: string) => void;
  /** Replaces the default pair of calls to action (used inside the app shell). */
  actions?: React.ReactNode;
  /** Off in the loading fallback, which is replaced as soon as the app mounts. */
  shader?: boolean;
}) {
  const shortcuts = useMemo(
    () =>
      baskets
        ? [...baskets]
            .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || (sinceLaunch(b) ?? 0) - (sinceLaunch(a) ?? 0))
            .slice(0, 4)
        : [],
    [baskets],
  );

  return (
    <section className={styles.hero}>
      {shader && <HeroShader className={styles.shader} palette="sunset" />}
      <div className={styles.copy}>
        <h1 className="t-hero">One token, a whole strategy.</h1>
        <p className="t-lead">Structured investing, onchain. One trade buys the whole basket of treasuries, stablebonds, gold and crypto, held in your own Stellar wallet.</p>
        <div className={styles.actions}>
          {actions ?? (
            <>
              <Link href="/baskets" className="btn btn-lg btn-ink">
                Browse baskets
              </Link>
              <Link href="/create" className={`btn btn-lg ${styles.secondary}`}>
                Create basket
              </Link>
            </>
          )}
        </div>
      </div>
      <div className={styles.slot}>
        <div className={styles.row}>
          {shortcuts.length > 0
            ? shortcuts.map((b) => <BasketChip key={b.address} basket={b} onOpen={onOpen} />)
            : [0, 1, 2, 3].map((i) => <span key={i} className={styles.chipSkeleton} aria-hidden />)}
        </div>
      </div>
    </section>
  );
}
