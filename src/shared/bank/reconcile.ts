// Abgleich vorläufiger Buchungen (Kurzbefehl, von Hand) mit den Zeilen eines Kontoauszugs. Reine Funktion.
import { diffDays } from "./num";

/** Vorläufige Buchung. Betrag in Rappen in der eigenen Währung (negativ = Ausgabe). */
export interface Vorlaeufig {
  id: string;
  account: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
}

/** Zeile aus dem Auszug: amount und currency wie im Auszug (Original), amountChf umgerechnet. */
export interface Auszugszeile {
  date: string;
  description: string;
  amount: number;
  currency: string;
  amountChf: number;
}

export interface Treffer {
  provisionalId: string;
  /** Index in der übergebenen Liste der Auszugszeilen */
  rowIndex: number;
  /** Namensähnlichkeit 0..1 */
  similarity: number;
  /** Tage Abstand */
  days: number;
}

export interface Abgleich {
  matches: Treffer[];
  /** Vorläufige im abgedeckten Zeitraum ohne Auszugszeile: bleiben als "nicht im Auszug" sichtbar */
  missing: string[];
  /** Vorläufige ausserhalb des Zeitraums oder anderen Kontos: bleiben unverändert */
  untouched: string[];
}

export interface AbgleichOptions {
  /** Konto des Auszugs; nur vorläufige dieses Kontos werden betrachtet */
  account: string;
  /** Höchster Datumsabstand in Tagen, Standard 3 */
  maxDays?: number;
}

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const tokens = (s: string) => strip(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const joined = (s: string) => tokens(s).join(" ");

const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** Wie ähnlich ist der Händlername dem Auszugstext? 1 = der Name steckt im Text, sonst Anteil gefundener Wörter. */
export function nameSimilarity(merchant: string, statementText: string): number {
  const m = joined(merchant);
  const s = joined(statementText);
  if (!m || !s) return 0;
  if (s.includes(m) || m.includes(s)) return 1;
  const mt = tokens(merchant);
  const st = tokens(statementText);
  const hit = mt.filter((w) => st.some((x) => sameWord(w, x))).length;
  return hit / mt.length;
}

/** Betrag und Währung müssen genau übereinstimmen: eine Trinkgeld-Abweichung ist kein Treffer. */
const sameAmount = (p: Vorlaeufig, r: Auszugszeile) => p.currency === r.currency && p.amount === r.amount;

/**
 * Ordnet jede vorläufige Buchung höchstens einer Auszugszeile zu und jede Zeile höchstens einer vorläufigen.
 * Bedingungen: gleicher Betrag in gleicher Währung, Datum höchstens maxDays auseinander.
 * Bei mehreren Möglichkeiten gewinnt das beste Paar zuerst: höchste Namensähnlichkeit, dann kleinster Datumsabstand,
 * dann die Reihenfolge der Eingabe. Fremdwährung: nur, wenn der Auszug den Originalbetrag in derselben Währung zeigt.
 * Der Zeitraum des Auszugs reicht vom frühesten bis zum spätesten Datum seiner Zeilen.
 */
export function reconcile(provisionals: Vorlaeufig[], rows: Auszugszeile[], options: AbgleichOptions): Abgleich {
  const maxDays = options.maxDays ?? 3;
  const mine = provisionals.filter((p) => p.account === options.account);
  const untouched = provisionals.filter((p) => p.account !== options.account).map((p) => p.id);
  if (!rows.length) return { matches: [], missing: [], untouched: [...untouched, ...mine.map((p) => p.id)] };
  const from = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0]!.date);
  const to = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0]!.date);

  const pairs: (Treffer & { pi: number })[] = [];
  mine.forEach((p, pi) => {
    rows.forEach((r, ri) => {
      if (!sameAmount(p, r)) return;
      const days = Math.abs(diffDays(p.date, r.date));
      if (days > maxDays) return;
      pairs.push({ provisionalId: p.id, rowIndex: ri, similarity: nameSimilarity(p.description, r.description), days, pi });
    });
  });
  pairs.sort((a, b) => b.similarity - a.similarity || a.days - b.days || a.pi - b.pi || a.rowIndex - b.rowIndex);

  const usedP = new Set<string>();
  const usedR = new Set<number>();
  const matches: Treffer[] = [];
  for (const { pi: _pi, ...pair } of pairs) {
    if (usedP.has(pair.provisionalId) || usedR.has(pair.rowIndex)) continue;
    usedP.add(pair.provisionalId);
    usedR.add(pair.rowIndex);
    matches.push(pair);
  }
  const missing: string[] = [];
  for (const p of mine) {
    if (usedP.has(p.id)) continue;
    if (p.date >= from && p.date <= to) missing.push(p.id);
    else untouched.push(p.id);
  }
  return { matches, missing, untouched };
}
