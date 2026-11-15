// Rechnen für die Tiefe (Geld, Körper): Wochen eines Monats, Händler, Kategorien-Adressen, Schnitte. Rein, ohne I/O.
import { addDays, mondayOf } from "./dates";
import { ownShare } from "./geld";
import type { Transaction } from "./schemas";

type Tx = Pick<Transaction, "id" | "date" | "amount" | "mealOut" | "isRepayment" | "settledAt" | "categoryId"> & { internal?: boolean; description?: string | null };

const r2 = (x: number) => Math.round(x * 100) / 100;

export interface MonthWeek { n: number; from: string; to: string }

/** Wochen eines Monats als Blöcke zu 7 Tagen (1–7, 8–14, 15–21, 22–28, Rest). */
export function weeksOfMonth(month: string): MonthWeek[] {
  const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const out: MonthWeek[] = [];
  for (let n = 1; n <= 5; n++) {
    const a = (n - 1) * 7 + 1;
    if (a > days) break;
    const b = n === 5 || a + 6 > days ? days : a + 6;
    out.push({ n, from: `${month}-${String(a).padStart(2, "0")}`, to: `${month}-${String(b).padStart(2, "0")}` });
  }
  return out;
}

/** Woche (1 bis 5) eines Datums innerhalb seines Monats. */
export const weekOfDate = (date: string) => Math.min(5, Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1);

export const inWeek = <T extends Tx>(txs: T[], month: string, n: number): T[] => {
  const w = weeksOfMonth(month).find((x) => x.n === n);
  return w ? txs.filter((t) => t.date >= w.from && t.date <= w.to) : [];
};

/** Eigene Ausgaben je Woche eines Monats. */
export function sumsByWeek(txs: Tx[], month: string): number[] {
  return weeksOfMonth(month).map((w) => r2(txs.filter((t) => t.date >= w.from && t.date <= w.to).reduce((s, t) => s + ownShare(t), 0)));
}

export const spendSum = (txs: Tx[]) => r2(txs.reduce((s, t) => s + ownShare(t), 0));

/** Adresse einer Kategorie: kleingeschrieben, Umlaute aufgelöst. Ohne Kategorie = "ohne". */
export function slug(name: string | null | undefined): string {
  if (!name) return "ohne";
  const s = name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "ohne";
}

/** Händlername aus dem Buchungstext der Banken (Revolut: "Name An: ...", Yuh: Zahlungsarten mit Nummern). */
export function merchantOf(description: string | null | undefined): { key: string; name: string } {
  let d = (description ?? "").replace(/\s+/g, " ").trim();
  if (!d) return { key: "unbekannt", name: "Unbekannt" };
  d = d.split(/ Referenz:| An: | Karte:/)[0]!.trim();
  const card = /^Zahlung per Debitkarte \d+ xxxx \d+ - (.+)$/i.exec(d);
  if (card) d = card[1]!;
  else {
    const m = /^(TWINT-Zahlung|Zahlung von|Zahlung an|Zahlung per [A-Za-z]+|Gutschrift|Dauerauftrag)\b ?(.*)$/i.exec(d);
    if (m) d = /^TWINT|^Zahlung per|^Dauerauftrag|^Gutschrift/i.test(m[1]!) ? m[1]! : m[2] ? m[2] : m[1]!;
  }
  // Ab dem ersten Wort mit Ziffer (Strasse, Nummer) oder einer Strassenendung abschneiden.
  const words: string[] = [];
  for (const w of d.split(" ")) {
    if (/\d/.test(w) && words.length > 0) break;
    if (/(strasse|gasse|weg|platz)$/i.test(w) && words.length > 0) break;
    if (/^\d+$/.test(w)) continue;
    words.push(w);
    if (/^(ag|gmbh|sa|sarl)$/i.test(w)) break;
  }
  const name = (words.join(" ") || d).slice(0, 60);
  const key = name.toLowerCase().replace(/[^a-zäöüéèà ]+/g, "").replace(/\s+/g, " ").trim() || "unbekannt";
  return { key, name };
}

export const sameMerchant = <T extends Tx>(txs: T[], t: Tx) => {
  const k = merchantOf(t.description).key;
  return txs.filter((x) => merchantOf(x.description).key === k);
};

/** Monate (YYYY-MM) mit Buchungen, neueste zuerst. */
export const monthsWithData = (txs: Tx[]) => [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort().reverse();

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Eigene Ausgaben je Tag eines Monats (Index 0 = 1.). */
export function spendPerDay(txs: Tx[], month: string): number[] {
  const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const out = Array.from({ length: days }, () => 0);
  for (const t of txs) if (t.date.startsWith(month)) out[Number(t.date.slice(8, 10)) - 1]! += ownShare(t);
  return out.map(r2);
}

export const mean = (v: number[]) => (v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null);

/* ---------- Körper: Wochen als Montag-Sonntag ---------- */
/** Montage aller Wochen, die den Zeitraum [from, to] berühren, älteste zuerst. */
export function mondaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) out.push(m);
  return out;
}
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** Schnitt der vorhandenen Werte (null ohne Werte). Auf eine Stelle genau wie die Anzeige braucht der Aufrufer selbst. */
export function avgOf(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Schnitt je Woche und Anzahl Tage mit Wert. */
export function weekAverages(byDay: Map<string, number | null>, mondays: string[]): { monday: string; avg: number | null; n: number }[] {
  return mondays.map((monday) => {
    const vals = weekDays(monday).map((d) => byDay.get(d) ?? null);
    return { monday, avg: avgOf(vals), n: vals.filter((x) => x !== null).length };
  });
}

/** Abweichung eines Werts zum Schnitt in Prozent (null ohne Schnitt). */
export const diffPct = (v: number, avg: number | null) => (avg && avg > 0 ? ((v - avg) / avg) * 100 : null);

/* ---------- Schule ---------- */
interface G { id: string; value: number; weight: number; date: string; createdAt?: string }
const avgW = (gs: G[]) => {
  const w = gs.reduce((s, g) => s + g.weight, 0);
  return w ? gs.reduce((s, g) => s + g.value * g.weight, 0) / w : null;
};
/** Fachschnitt vor und nach einer Note (Reihenfolge: Datum, dann Eingabe). `delta` ist null bei der ersten Note. */
export function gradeImpact(grades: G[], id: string): { before: number | null; after: number; delta: number | null } | null {
  const sorted = [...grades].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
  const i = sorted.findIndex((g) => g.id === id);
  if (i < 0) return null;
  const before = avgW(sorted.slice(0, i));
  const after = avgW(sorted.slice(0, i + 1))!;
  return { before, after, delta: before === null ? null : after - before };
}

/** Zu welchem Thema gehört eine Lernaufgabe ("E lernen: Past tense")? */
export function taskTopic<T extends { title: string }>(task: { title: string; examId: string | null }, topics: T[]): T | null {
  if (!task.examId) return null;
  return topics.find((t) => task.title.endsWith(`: ${t.title}`)) ?? null;
}
