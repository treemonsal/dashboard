// Geldrechnung. Negativ = Ausgabe. Mahlzeiten auswärts: die Mutter zahlt die Hälfte zurück.
import type { Transaction } from "./schemas";

type Tx = Pick<Transaction, "id" | "date" | "amount" | "mealOut" | "isRepayment" | "settledAt" | "categoryId">;

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Eigener Anteil einer Ausgabe: bei Mahlzeiten auswärts die Hälfte. */
export function ownShare(t: Tx): number {
  if (t.amount >= 0 || t.isRepayment) return 0;
  return t.mealOut ? -t.amount / 2 : -t.amount;
}

export interface MonthSummary {
  /** Eigene Ausgaben (Anteil) */
  spent: number;
  /** Was nach Abzug vom frei verfügbaren Budget übrig bleibt */
  left: number;
  budget: number;
  /** Echte Einnahmen ohne Rückzahlungen der Mutter */
  income: number;
  hasData: boolean;
}

export function monthSummary(txs: Tx[], budget: number): MonthSummary {
  const spent = r2(txs.reduce((s, t) => s + ownShare(t), 0));
  const income = r2(txs.filter((t) => t.amount > 0 && !t.isRepayment).reduce((s, t) => s + t.amount, 0));
  return { spent, left: r2(budget - spent), budget, income, hasData: txs.length > 0 };
}

export function budgetOf(salary: string, invest: string): number {
  return Math.max(0, Number(salary) - Number(invest));
}

/** Ausgaben nach Kategorie, eigener Anteil, grösste zuerst. */
export function byCategory(txs: Tx[]): { categoryId: string | null; amount: number }[] {
  const m = new Map<string | null, number>();
  for (const t of txs) {
    const v = ownShare(t);
    if (v > 0) m.set(t.categoryId ?? null, (m.get(t.categoryId ?? null) ?? 0) + v);
  }
  return [...m].map(([categoryId, amount]) => ({ categoryId, amount: r2(amount) })).sort((a, b) => b.amount - a.amount);
}

export interface MealState {
  tx: Tx;
  /** Erwartete Rückzahlung: 50 Prozent */
  expected: number;
  /** Davon durch eingegangene Zahlungen gedeckt */
  covered: number;
  status: "open" | "partial" | "settled";
}

/**
 * Offene Rückzahlungen. Eingehende Zahlungen der Mutter (isRepayment) werden der Reihe nach
 * (älteste Mahlzeit zuerst) gegen die nicht von Hand beglichenen Mahlzeiten verrechnet.
 */
export function mamaBalance(txs: Tx[]): { open: number; meals: MealState[] } {
  const meals = txs.filter((t) => t.mealOut && t.amount < 0 && !t.isRepayment).sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
  let pool = txs.filter((t) => t.isRepayment && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  let open = 0;
  const out: MealState[] = meals.map((tx) => {
    const expected = r2(-tx.amount / 2);
    if (tx.settledAt) return { tx, expected, covered: expected, status: "settled" as const };
    const covered = r2(Math.min(pool, expected));
    pool = r2(pool - covered);
    const left = r2(expected - covered);
    open += left;
    return { tx, expected, covered, status: left <= 0 ? ("settled" as const) : covered > 0 ? ("partial" as const) : ("open" as const) };
  });
  return { open: r2(open), meals: out };
}

/** Depot: Einzahlungen aus monatlichem Betrag ab Startdatum plus einmalige Einträge. */
export function depositTotal(o: { monthly: number; start: string; today: string; extra: number }): number {
  let n = 0;
  if (o.start && o.start <= o.today) {
    n = (Number(o.today.slice(0, 4)) - Number(o.start.slice(0, 4))) * 12 + (Number(o.today.slice(5, 7)) - Number(o.start.slice(5, 7))) + 1;
  }
  return r2(n * o.monthly + o.extra);
}
