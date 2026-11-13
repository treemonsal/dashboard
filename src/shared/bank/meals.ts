// Mahlzeiten auswärts: die Mutter zahlt die Hälfte per Twint zurück.
import { CAT } from "./categorize";
import { diffDays, roundHalfUp } from "./num";
import type { Buchung } from "./types";

export interface MealSettings {
  payerName?: string;
  /** Ab diesem CHF-Betrag (Rappen) gilt eine Gastronomie-Buchung als Mahlzeit, darunter als Snack. Standard 1000. */
  minMealRappen?: number;
}

export interface MealEntry {
  row: Buchung;
  /** Erwarteter Anteil der Mutter (50 %, kaufmännisch gerundet), Rappen */
  expected: number;
  received: number;
  open: number;
  settledBy: { row: Buchung; rappen: number }[];
}

export interface MealResult {
  meals: MealEntry[];
  openMeals: MealEntry[];
  settled: MealEntry[];
  /** Summe, die die Mutter noch schuldet (Rappen) */
  openRappen: number;
  /** Eingänge der Mutter, die keiner Mahlzeit zugeordnet werden konnten (ggf. Restbetrag) */
  unmatchedIncoming: { row: Buchung; rappen: number }[];
  /** Alle Eingänge der Mutter (zugeordnet oder nicht): zählen nicht als Einkommen */
  repaymentRows: Set<Buchung>;
}

export const DEFAULT_MIN_MEAL = 1000;

export function isMeal(row: Buchung, minMealRappen = DEFAULT_MIN_MEAL): boolean {
  if (row.amountChf >= 0 || row.internal) return false;
  if (row.isMeal !== undefined) return row.isMeal;
  return row.category === CAT.dining && -row.amountChf >= minMealRappen;
}

export function mealExpected(row: Buchung): number {
  return roundHalfUp(-row.amountChf / 2);
}

const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/** Text enthält den Namen (alle Namensteile in beliebiger Reihenfolge; Nachname plus Initiale genügt). */
export function mentionsPayer(row: Buchung, payerName: string): boolean {
  const name = words(payerName);
  if (!name.length) return false;
  const text = words(`${row.description} ${row.counterparty ?? ""}`);
  if (name.every((w) => text.includes(w))) return true;
  if (name.length < 2) return false;
  const longest = [...name].sort((a, b) => b.length - a.length)[0]!;
  return text.includes(longest) && name.filter((w) => w !== longest).every((w) => text.some((t) => t === w || t === w[0]));
}

export function mealShares(rows: Buchung[], settings: MealSettings = {}): MealResult {
  const min = settings.minMealRappen ?? DEFAULT_MIN_MEAL;
  const byDate = (a: Buchung, b: Buchung) => a.date.localeCompare(b.date);
  const meals: MealEntry[] = rows
    .filter((r) => isMeal(r, min))
    .sort(byDate)
    .map((row) => ({ row, expected: mealExpected(row), received: 0, open: mealExpected(row), settledBy: [] }));

  const repaymentRows = new Set<Buchung>();
  const unmatchedIncoming: MealResult["unmatchedIncoming"] = [];
  const name = settings.payerName?.trim();
  if (name) {
    const incoming = rows.filter((r) => r.amountChf > 0 && !r.internal && mentionsPayer(r, name)).sort(byDate);
    for (const inc of incoming) {
      repaymentRows.add(inc);
      let left = inc.amountChf;
      for (const m of meals) {
        if (left <= 0) break;
        // Twint kommt oft vor der Kartenverbuchung an: bis 3 Tage Vorlauf erlaubt
        if (m.open <= 0 || diffDays(m.row.date, inc.date) > 3) continue;
        const pay = Math.min(left, m.open);
        m.open -= pay;
        m.received += pay;
        m.settledBy.push({ row: inc, rappen: pay });
        left -= pay;
      }
      if (left > 0) unmatchedIncoming.push({ row: inc, rappen: left });
    }
  }
  return {
    meals,
    openMeals: meals.filter((m) => m.open > 0),
    settled: meals.filter((m) => m.open <= 0),
    openRappen: meals.reduce((s, m) => s + m.open, 0),
    unmatchedIncoming,
    repaymentRows,
  };
}
