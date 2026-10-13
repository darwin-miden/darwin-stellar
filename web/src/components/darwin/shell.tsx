"use client";

/**
 * The pieces the hero needs on both sides of the mount: the app shell renders the live
 * version, the page's loading fallback renders the same hero while the app chunk is still
 * downloading. Sharing them here keeps the two from drifting apart by a pixel.
 */

import { Instrument_Sans } from "next/font/google";
import type { CSSProperties } from "react";

import { heroSecondary } from "./Hero";

export const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: "variable", variable: "--font-instrument-sans" });

/** The standalone front's own container (1440 / 48px), wider than the app's `--max`. */
export const darwinContainer: CSSProperties = {
  maxWidth: 1440,
  margin: "0 auto",
  padding: "clamp(28px, 5vh, 56px) 48px",
};

/** The Explore baskets section, which the hero's primary action scrolls down to. */
export const EXPLORE_SECTION_ID = "explore-baskets-section";

export function scrollToExplore() {
  document.getElementById(EXPLORE_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The hero's calls to action — the same pair signed out and connected. */
export function HeroActions() {
  return (
    <>
      <button type="button" className="btn btn-lg btn-ink" onClick={scrollToExplore}>
        Explore baskets
      </button>
      <a className={`btn btn-lg ${heroSecondary}`} href="https://github.com/darwin-miden/darwin-stellar#readme" target="_blank" rel="noreferrer">
        Documentation
      </a>
    </>
  );
}
