"use client";

/**
 * The Darwin front's home block, dropped into the app: the hero with its basket
 * shortcuts, then the Explore baskets grid. Styling is scoped to `.darwin-ui`.
 */

import { useMemo } from "react";
import { useBaskets } from "@/lib/darwin/store";
import { BasketTile } from "./BasketTile";
import { Hero } from "./Hero";
import { sinceLaunch } from "./sinceLaunch";
import { EXPLORE_SECTION_ID, instrumentSans } from "./shell";
import tiles from "./BasketTile.module.css";
import styles from "./DarwinHome.module.css";
import "./darwin-ui.css";

export function DarwinHome({
  onOpen,
  actions,
  shader = true,
}: {
  /** Opens a basket: the trade panel when connected, the connect modal otherwise. */
  onOpen?: (symbol: string) => void;
  /** Hero calls to action; defaults to the front's Browse / Create pair. */
  actions?: React.ReactNode;
  /** Off in the loading fallback, which the mounted app replaces moments later. */
  shader?: boolean;
}) {
  const { data: baskets, error } = useBaskets();
  // Best run since launch first, like the standalone front.
  const explore = useMemo(
    () => (baskets ? [...baskets].sort((a, b) => (sinceLaunch(b) ?? 0) - (sinceLaunch(a) ?? 0)) : []),
    [baskets],
  );

  return (
    <div className={`darwin-ui ${instrumentSans.variable} ${styles.home}`}>
      <Hero baskets={baskets} onOpen={onOpen} actions={actions} shader={shader} />
      {error && <div className={styles.error}>{error}</div>}

      {explore.length > 0 && (
        <section id={EXPLORE_SECTION_ID} className={styles.discoverySection} aria-labelledby="explore-baskets">
          {/* Heading only — there is no separate list page to link to: the grid below is every basket. */}
          <div className={styles.sectionHeader}>
            <h2 className="t-h2" id="explore-baskets">
              Explore baskets
            </h2>
          </div>
          <div className={tiles.grid}>
            {explore.map((b) => (
              <BasketTile key={b.address} b={b} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
