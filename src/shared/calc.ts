import type { Grade } from "./schemas";

/** Gewichteter Schnitt, auf zwei Stellen. null, wenn keine Noten. */
export function weightedAverage(gs: Pick<Grade, "value" | "weight">[]): number | null {
  const w = gs.reduce((s, g) => s + g.weight, 0);
  if (!w) return null;
  return Math.round((gs.reduce((s, g) => s + g.value * g.weight, 0) / w) * 100) / 100;
}
