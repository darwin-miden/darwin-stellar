"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { HeroPalette } from "./HeroShaderCanvas";

type CanvasComponent = ComponentType<{ className?: string; palette?: HeroPalette }>;

/** Loads the WebGPU hero background lazily; a plain placeholder until then (or for reduced motion). */
export function HeroShader({ className, palette }: { className?: string; palette?: HeroPalette }) {
  const [Canvas, setCanvas] = useState<CanvasComponent | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    import("./HeroShaderCanvas").then(({ default: component }) => {
      if (!cancelled) setCanvas(() => component);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Canvas ? <Canvas className={className} palette={palette} /> : <div className={className} aria-hidden="true" />;
}
