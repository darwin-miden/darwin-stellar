"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { Basket } from "@/lib/darwin/types";

/**
 * A basket opens its page on the standalone front; inside the app it hands the
 * symbol back so the shell can open the trade panel (or the connect modal).
 */
export function BasketLink({
  basket,
  className,
  ariaLabel,
  onOpen,
  children,
}: {
  basket: Basket;
  className?: string;
  ariaLabel?: string;
  onOpen?: (symbol: string) => void;
  children: ReactNode;
}) {
  // A basket whose faucets aren't deployed yet opens nothing, like the app's own cards.
  if (!basket.live) {
    return (
      <div className={className} aria-label={ariaLabel} aria-disabled="true">
        {children}
      </div>
    );
  }
  if (onOpen) {
    return (
      <button type="button" className={className} aria-label={ariaLabel} onClick={() => onOpen(basket.symbol)}>
        {children}
      </button>
    );
  }
  return (
    <Link href={`/basket/${basket.address}`} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
