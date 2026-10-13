"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Keeps the scroll position sane when a basket screen opens over the grid.
 *
 * THE PROBLEM. AgamaFrame's cream panel (`.frame-panel`) is the only scroller — the window never
 * scrolls. The grid and every basket screen live inside that one panel, and opening a basket only
 * swaps which of them is `display:none`. The panel's scrollTop survives the swap, so scrolling down
 * the grid to reach a basket meant landing that same distance down the basket screen instead of at
 * its title.
 *
 * Resetting unconditionally would trade one annoyance for another: the grid is deliberately kept
 * mounted so going back restores where you were in it, and a shared scroller means a reset on open
 * is also a reset on return. So the grid's position is remembered, and put back on the way out.
 *
 * WHY THE POSITION IS CAPTURED ON CLICK AND NOT READ WHEN A BASKET OPENS. By the time an effect
 * runs, React has already hidden the grid, the panel is only as tall as the basket screen, and the
 * browser has clamped scrollTop to that smaller height — reading it then returned 420 for a grid
 * that was at 486, and the real position was already gone. A capture-phase listener on the panel
 * runs before React's own click handling, so it still sees the grid as it was. Scroll events would
 * also have worked, but a browser stops firing them in a backgrounded tab, which is exactly the
 * state a restored tab starts in.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const panelEl = () => document.querySelector<HTMLElement>(".frame-panel");

export function usePanelScroll(openSymbol: string | null): void {
  const gridScroll = useRef(0);
  const previous = useRef<string | null>(null);

  // While the grid is what's on screen, note where it stands at the moment anything in it is
  // clicked — one of those clicks is the one that opens a basket.
  useIsomorphicLayoutEffect(() => {
    if (openSymbol) return;
    const panel = panelEl();
    if (!panel) return;
    const onClick = () => {
      gridScroll.current = panel.scrollTop;
    };
    panel.addEventListener("click", onClick, { capture: true });
    return () => panel.removeEventListener("click", onClick, { capture: true });
  }, [openSymbol]);

  useIsomorphicLayoutEffect(() => {
    const was = previous.current;
    previous.current = openSymbol;
    if (was === openSymbol) return;

    const panel = panelEl();
    if (!panel) return;

    if (openSymbol) {
      // Opening a basket, or swapping one for another: start at its title either way. Falling back
      // to the live value covers a first paint where no scroll event has fired yet.
      if (!was) gridScroll.current = Math.max(gridScroll.current, panel.scrollTop);
      panel.scrollTop = 0;
      return;
    }

    // Back to the grid, where you left it. Its charts and tiles have not finished laying out at
    // this point, so the panel can still be shorter than it will be and the browser clamps us
    // short of the mark. Re-apply until the real height arrives.
    //
    // Deliberately setTimeout and not requestAnimationFrame: rAF is throttled to a standstill in a
    // background tab, which is exactly where a restored tab starts, and the retry would never run.
    const target = gridScroll.current;
    panel.scrollTop = target;
    if (panel.scrollTop >= target) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    // If the reader starts scrolling themselves, their input wins and we stop pulling them back.
    const abort = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const retry = () => {
      panel.scrollTop = target;
      if (panel.scrollTop >= target || ++tries >= 10) return abort();
      timer = setTimeout(retry, 50);
    };
    timer = setTimeout(retry, 0);
    panel.addEventListener("wheel", abort, { passive: true, once: true });
    panel.addEventListener("touchstart", abort, { passive: true, once: true });

    return () => {
      abort();
      panel.removeEventListener("wheel", abort);
      panel.removeEventListener("touchstart", abort);
    };
  }, [openSymbol]);
}
