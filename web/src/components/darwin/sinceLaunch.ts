import type { Basket } from "@/lib/darwin/types";

/** Growth of one share since its units were fixed, or null when inception is unknown. */
export function sinceLaunch(b: Basket) {
  if (!b.shareAtInception || b.navUsd <= 0) return null;
  return b.navUsd / b.shareAtInception - 1;
}
