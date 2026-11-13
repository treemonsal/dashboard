import type { Grade } from "./schemas";

export const TARGET_AVERAGE = 4.5;
export const MIN_SUBJECT = 4;

/** Gewichteter Schnitt, auf zwei Stellen. null, wenn keine Noten. */
export function weightedAverage(gs: Pick<Grade, "value" | "weight">[]): number | null {
  const w = gs.reduce((s, g) => s + g.weight, 0);
  if (!w) return null;
  return Math.round((gs.reduce((s, g) => s + g.value * g.weight, 0) / w) * 100) / 100;
}

/** Gesamtschnitt: Mittel der Fachschnitte (Fächer ohne Note zählen nicht). */
export function overallAverage(subjectAverages: (number | null)[]): number | null {
  const v = subjectAverages.filter((x): x is number => x !== null);
  if (!v.length) return null;
  return Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100;
}

export type Needed = { kind: "reached" } | { kind: "impossible"; needed: number } | { kind: "need"; value: number };

/**
 * Welche Note brauche ich in einer weiteren Prüfung (Gewicht `weight`), damit der Fachschnitt `target` erreicht?
 * Aufgerundet auf eine Dezimale, damit das Ziel sicher erreicht wird.
 */
export function neededGrade(gs: Pick<Grade, "value" | "weight">[], target: number, weight = 1): Needed | null {
  if (!(weight > 0)) return null;
  const w = gs.reduce((s, g) => s + g.weight, 0);
  const sum = gs.reduce((s, g) => s + g.value * g.weight, 0);
  const raw = (target * (w + weight) - sum) / weight;
  const x = Math.ceil(raw * 10 - 1e-9) / 10;
  if (x <= 1) return { kind: "reached" };
  if (x > 6) return { kind: "impossible", needed: x };
  return { kind: "need", value: x };
}

/** Zeugnisnote: auf halbe Noten gerundet. */
export function roundHalf(x: number): number {
  return Math.round(x * 2) / 2;
}
