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

/** Zeugnisnote: kaufmännisch auf halbe Noten gerundet (3.25 wird 3.5, 3.75 wird 4, 3.24 bleibt 3). */
export function roundHalf(x: number): number {
  return Math.floor(x * 2 + 0.5 + 1e-9) / 2;
}

/** Beide Zahlen eines Fachs: genau (fürs Ziel) und Zeugnis (gerundet). null ohne Noten. */
export function subjectMarks(avg: number | null): { exact: number; certificate: number } | null {
  return avg === null ? null : { exact: avg, certificate: roundHalf(avg) };
}

/** Fächer, die nicht zählen (counts = false), bleiben aus Schnitt, Ziel und "kein Fach unter 4" draussen. */
export function onlyCounting<T extends { counts: boolean }>(rows: T[]): T[] {
  return rows.filter((r) => r.counts);
}

/** Gesamtschnitt über die zählenden Fächer. */
export function countingAverage(rows: { counts: boolean; avg: number | null }[]): number | null {
  return overallAverage(onlyCounting(rows).map((r) => r.avg));
}
