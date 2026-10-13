"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Agama-style app frame (recolored to Darwin orange): a full-height ORANGE GRADIENT outer with the
 * navbar sitting directly on it, and a CREAM rounded panel below that holds — and scrolls — the content.
 * This is Agama's signature look: the colored gradient strip at the top carries the navbar, and the beige
 * area is reduced to just the content panel below it.
 *
 * `nav` renders on the gradient (use light text — see navText/navLogo helpers), `children` fill the cream
 * panel. Modals/overlays (position: fixed) can live anywhere in children — they're viewport-relative.
 */
export function AgamaFrame({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="frame-gradient" style={outer}>
      <div style={navRow}>{nav}</div>
      <div className="frame-panel frame-panel-rounded" style={panel}>
        {children}
      </div>
    </div>
  );
}

const outer: CSSProperties = {
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
  fontFamily: "var(--font-sans-stack)",
  color: "var(--ink)",
};
// The navbar strip on the gradient. Kept COMPACT (like Agama) so the cream panel starts high and the
// beige area isn't over-reduced. Small side inset so it lines up with the panel's rounded corners.
const navRow: CSSProperties = { flexShrink: 0, padding: "2px 10px 0" };
const panel: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  margin: "4px 10px 10px",
};

/** On the orange gradient the navbar text/controls read best in cream/white. */
export const navOnGradient: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "8px clamp(14px, 3vw, 30px)",
  color: "#fdf8ed",
};
