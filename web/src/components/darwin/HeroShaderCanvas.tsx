"use client";

import { useEffect, useState } from "react";
import { CursorRipples, FractalNoise, Shader, Swirl, Watercolor } from "shaders/react";

export type HeroPalette = "ocean" | "sunset";

/** Swirl gradient stops per palette. `ocean` is the original blue-to-clay hero. */
const PALETTES: Record<HeroPalette, { color: string; position: number }[]> = {
  ocean: [
    { color: "#225fa6", position: 0 },
    { color: "#2f6fb3", position: 0.18 },
    { color: "#5f94d1", position: 0.38 },
    { color: "#97aed6", position: 0.62 },
    { color: "#d1b8af", position: 0.82 },
    { color: "#dea48b", position: 1 },
  ],
  sunset: [
    { color: "#7a1f00", position: 0 },
    { color: "#b93200", position: 0.18 },
    { color: "#e85d04", position: 0.38 },
    { color: "#f97316", position: 0.62 },
    { color: "#fb8c2a", position: 0.82 },
    { color: "#ff9f45", position: 1 },
  ],
};

/** The arrival gesture: a short, slightly bowed flick near the top-right corner. */
const INTRO_MS = 820;
const INTRO_FROM = { x: 0.845, y: 0.21 };
const INTRO_TO = { x: 0.915, y: 0.13 };
const INTRO_BOW = 0.012;

export default function HeroShaderCanvas({ className, palette = "ocean" }: { className?: string; palette?: HeroPalette }) {
  const [ready, setReady] = useState(false);

  /*
   * On arrival, flick a pointer across the top-right corner. The shader already answers the
   * cursor with ripples; this just performs the gesture once -- small, the way a mouse
   * brushes past -- so the hero greets you in motion rather than waiting for a real one.
   * The shader listens on window, hence the dispatch there.
   */
  useEffect(() => {
    if (!ready || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const host = document.querySelector<HTMLElement>("[data-hero-shader]");
    const box = host?.getBoundingClientRect();
    if (!box?.width) return;

    const from = { x: box.left + box.width * INTRO_FROM.x, y: box.top + box.height * INTRO_FROM.y };
    const to = { x: box.left + box.width * INTRO_TO.x, y: box.top + box.height * INTRO_TO.y };
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / INTRO_MS);
      const eased = 1 - (1 - t) ** 3;
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: from.x + (to.x - from.x) * eased,
          clientY: from.y + (to.y - from.y) * eased + Math.sin(Math.PI * t) * box.height * INTRO_BOW,
        }),
      );
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return (
    <Shader
      className={className}
      toneMapping="cineon"
      disableTelemetry
      data-hero-shader=""
      data-ready={ready || undefined}
      onReady={() => setReady(true)}
      onUnavailable={() => setReady(false)}
      aria-hidden="true"
    >
      <Swirl colorSpace="oklab" detail={0.6} stops={PALETTES[palette]} />
      <FractalNoise
        angle={-137}
        blendMode="softLight"
        contrast={0.19}
        detail={1.9}
        octaves={1}
        opacity={0.4}
        speed={0.57}
        stops={[
          { color: "#000000", position: 0 },
          { color: "#ffffff", position: 1 },
        ]}
      />
      <CursorRipples chromaticSplit={0} decay={3.3} intensity={17.4} radius={1} />
      <Watercolor bleed={2.9} paper={0.07} />
    </Shader>
  );
}
