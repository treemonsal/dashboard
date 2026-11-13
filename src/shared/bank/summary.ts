import { CAT } from "./categorize";
import { isMeal, mealExpected, mealShares, type MealSettings } from "./meals";
import { diffDays } from "./num";
import type { Buchung } from "./types";

export interface CategoryTotal {
  category: string;
  count: number;
  /** eigener Anteil in Rappen (positiv) */
  amount: number;
  /** Anteil an den Gesamtausgaben, 0..1 */
  share: number;
}

export interface MonthSummary {
  month: string;
  budget: number;
  /** Eigener Anteil der Ausgaben in Rappen (positiv): ohne interne Überweisungen und Anlage, Mahlzeiten zur Hälfte */
  spent: number;
  left: number;
  /** Einnahmen ohne interne Überweisungen, Anlage und Rückzahlungen der Mutter */
  income: number;
  byCategory: CategoryTotal[];
  /** Pro Tag von 1 bis daysElapsed */
  daily: { date: string; spent: number; cumulative: number }[];
  daysInMonth: number;
  daysElapsed: number;
  /** Linear hochgerechnete Monatsausgaben (aktueller Tagesschnitt mal Monatstage) */
  projected: number;
  /** Budget minus Hochrechnung (negativ = Überschreitung droht) */
  projectedLeft: number;
}

export interface SummaryOptions extends MealSettings {
  /** "Heute" (YYYY-MM-DD); Standard: jüngste Buchung in rows */
  today?: string;
}

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthSummary(rows: Buchung[], month: string, budgetRappen: number, options: SummaryOptions = {}): MonthSummary {
  const meals = mealShares(rows, options);
  const min = options.minMealRappen;
  const inMonth = rows.filter((r) => r.date.startsWith(month));
  const n = daysIn(month);

  const asOf = options.today ?? rows.reduce((mx, r) => (r.date > mx ? r.date : mx), "");
  let elapsed: number;
  if (!asOf || asOf >= `${month}-${String(n).padStart(2, "0")}`) elapsed = n;
  else if (asOf < `${month}-01`) elapsed = 0;
  else elapsed = diffDays(asOf, `${month}-01`) + 1;

  const perDay = new Map<string, number>();
  const cats = new Map<string, { count: number; amount: number }>();
  let spent = 0;
  let income = 0;
  for (const r of inMonth) {
    if (r.internal || r.category === CAT.invest || meals.repaymentRows.has(r)) continue;
    if (r.amountChf > 0) {
      income += r.amountChf;
      continue;
    }
    if (r.amountChf === 0) continue;
    const own = isMeal(r, min) ? -r.amountChf - mealExpected(r) : -r.amountChf;
    spent += own;
    perDay.set(r.date, (perDay.get(r.date) ?? 0) + own);
    const key = r.category ?? "Unkategorisiert";
    const c = cats.get(key) ?? { count: 0, amount: 0 };
    c.count++;
    c.amount += own;
    cats.set(key, c);
  }

  const daily: MonthSummary["daily"] = [];
  let cum = 0;
  for (let d = 1; d <= elapsed; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const s = perDay.get(date) ?? 0;
    cum += s;
    daily.push({ date, spent: s, cumulative: cum });
  }
  const projected = elapsed > 0 && elapsed < n ? Math.max(spent, Math.round((spent / elapsed) * n)) : spent;

  return {
    month,
    budget: budgetRappen,
    spent,
    left: budgetRappen - spent,
    income,
    byCategory: [...cats.entries()]
      .map(([category, c]) => ({ category, count: c.count, amount: c.amount, share: spent ? c.amount / spent : 0 }))
      .sort((a, b) => b.amount - a.amount),
    daily,
    daysInMonth: n,
    daysElapsed: elapsed,
    projected,
    projectedLeft: budgetRappen - projected,
  };
}
