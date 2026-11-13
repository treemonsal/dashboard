// Generische Spaltenerkennung über Synonyme (für ZKB, Yuh und alles Unbekannte).
import type { ColumnMapping } from "./types";

type Field = "date" | "valuta" | "description" | "amount" | "debit" | "credit" | "balance" | "currency" | "amountChf" | "counterparty";

export function normHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SYNONYMS: Record<Field, string[]> = {
  amountChf: ["Betrag CHF", "Betrag in CHF", "CHF Betrag", "Amount CHF", "Amount in CHF", "Umsatz CHF"],
  debit: ["Belastung", "Soll", "Debit", "Ausgabe", "Ausgaben", "Lastschrift", "Withdrawal"],
  credit: ["Gutschrift", "Haben", "Credit", "Einnahme", "Einnahmen", "Deposit"],
  balance: ["Saldo", "Balance", "Kontostand"],
  currency: ["Währung", "Currency", "Whg", "Curr"],
  valuta: ["Valuta", "Valutadatum", "Value Date", "Valuedate"],
  date: ["Datum", "Buchungsdatum", "Buchungstag", "Date", "Transaktionsdatum", "Booking Date", "Transaction Date", "Bookingdate"],
  description: ["Buchungstext", "Text", "Beschreibung", "Description", "Details", "Verwendungszweck", "Mitteilung", "Zahlungszweck", "Activity Name", "Buchungsdetails", "Transaktion"],
  counterparty: ["Empfänger", "Begünstigter", "Auftraggeber", "Recipient", "Sender", "Merchant", "Payee", "Gegenpartei"],
  amount: ["Betrag", "Amount", "Umsatz"],
};

const ORDER: Field[] = ["amountChf", "debit", "credit", "balance", "currency", "valuta", "date", "description", "counterparty", "amount"];

const SYN_TOKENS: Record<Field, string[][]> = Object.fromEntries(
  ORDER.map((f) => [f, SYNONYMS[f].map((s) => normHeader(s).split(" "))]),
) as Record<Field, string[][]>;

function containsRun(hay: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((t, j) => hay[i + j] === t)) return true;
  return false;
}

/** 2 = exakter Treffer, 1 = Synonym kommt als Wortfolge in der Kopfzelle vor, 0 = kein Treffer */
function matchScore(header: string, field: Field): number {
  const toks = normHeader(header).split(" ").filter(Boolean);
  if (!toks.length) return 0;
  let best = 0;
  for (const syn of SYN_TOKENS[field]) {
    if (syn.length === toks.length && syn.every((t, i) => t === toks[i])) return 2;
    if (containsRun(toks, syn)) best = 1;
  }
  return best;
}

export interface ColumnGuess {
  mapping: ColumnMapping;
  /** true, wenn Datum, Text und Betrag (oder Soll und Haben) gefunden wurden */
  confident: boolean;
  /** Fehlende Pflichtfelder */
  missing: string[];
  /** Anzahl erkannter Spalten */
  recognized: number;
}

/** Schlägt eine Zuordnung Spalte -> Feld für eine Kopfzeile vor. */
export function guessColumns(header: string[]): ColumnGuess {
  const taken = new Set<number>();
  const m: Partial<Record<Field, number>> = {};
  for (const level of [2, 1]) {
    for (const f of ORDER) {
      if (m[f] !== undefined) continue;
      const idx = header.findIndex((h, i) => !taken.has(i) && matchScore(h, f) === level);
      if (idx >= 0) {
        m[f] = idx;
        taken.add(idx);
      }
    }
  }
  const recognized = taken.size;
  if (m.date === undefined && m.valuta !== undefined) m.date = m.valuta;
  if (m.amount === undefined && m.debit === undefined && m.credit === undefined && m.amountChf !== undefined) {
    m.amount = m.amountChf;
    delete m.amountChf;
  }
  const mapping: ColumnMapping = { ...m };
  const missing: string[] = [];
  if (m.date === undefined) missing.push("date");
  if (m.description === undefined) missing.push("description");
  if (m.amount === undefined) {
    if (m.debit === undefined && m.credit === undefined) missing.push("amount");
    else if (m.debit === undefined) missing.push("debit");
    else if (m.credit === undefined) missing.push("credit");
  }
  // Währung aus der Kopfzeile (z.B. "Belastung CHF"), falls keine Währungsspalte existiert
  if (m.currency === undefined) {
    for (const i of [m.amount, m.debit, m.credit]) {
      const c = i !== undefined ? header[i]?.match(/\b(CHF|EUR|USD|GBP)\b/i) : null;
      if (c) {
        mapping.defaultCurrency = c[1]!.toUpperCase();
        break;
      }
    }
  }
  return { mapping, confident: missing.length === 0, missing, recognized };
}

/** Sucht die Kopfzeile nach Vorspannzeilen. -1, wenn nichts Brauchbares gefunden wurde. */
export function findHeaderRow(table: string[][]): number {
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < Math.min(table.length, 80); i++) {
    const row = table[i]!;
    if (row.length < 2) continue;
    const g = guessColumns(row);
    if (g.confident) return i;
    if (g.recognized > bestScore) {
      best = i;
      bestScore = g.recognized;
    }
  }
  return best;
}
