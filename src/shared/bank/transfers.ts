import { diffDays } from "./num";
import type { Buchung } from "./types";

/**
 * Erkennt Paare aus verschiedenen Konten: gleicher Betrag mit umgekehrtem Vorzeichen, gleiche Währung,
 * höchstens 3 Tage auseinander. Beide Seiten bekommen internal = true. Jede Buchung gehört zu höchstens einem Paar.
 * Gibt Kopien zurück, die Eingabe bleibt unverändert.
 */
export function markInternalTransfers(rows: Buchung[], maxDays = 3): Buchung[] {
  const out = rows.map((r) => ({ ...r }));
  const used = new Set<number>();
  const order = out.map((_, i) => i).filter((i) => out[i]!.amount < 0).sort((a, b) => out[a]!.date.localeCompare(out[b]!.date) || a - b);
  for (const i of order) {
    const a = out[i]!;
    let best = -1;
    let bestDiff = Infinity;
    for (let j = 0; j < out.length; j++) {
      const b = out[j]!;
      if (used.has(j) || j === i || b.amount !== -a.amount || b.currency !== a.currency) continue;
      if ((a.account ?? "") === (b.account ?? "")) continue;
      const d = Math.abs(diffDays(a.date, b.date));
      if (d <= maxDays && d < bestDiff) {
        best = j;
        bestDiff = d;
      }
    }
    if (best >= 0) {
      used.add(i).add(best);
      a.internal = true;
      out[best]!.internal = true;
    }
  }
  return out;
}
