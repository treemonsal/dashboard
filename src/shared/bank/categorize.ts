// Kategorisierung nach Regeln und Lernen aus Korrekturen.
import type { Buchung } from "./types";

export interface Rule {
  /** Teilstring, Gross/Klein egal */
  pattern: string;
  category: string;
  /** Erzwingt Mahlzeit (true) oder Snack (false) für diese Händler; sonst entscheidet die Schwelle */
  isMeal?: boolean;
  /** Muster nur als ganzes Wort treffen (für kurze Namen wie "Spar", "Tier", "Lime") */
  wholeWord?: boolean;
}

export const CAT = {
  food: "Lebensmittel",
  transport: "Transport",
  dining: "Gastronomie",
  fun: "Unterhaltung",
  invest: "Sparen/Anlage",
  income: "Einkommen",
  other: "Sonstiges",
} as const;

const r = (category: string, patterns: string[], wholeWord: string[] = []): Rule[] => [
  ...patterns.map((pattern) => ({ pattern, category })),
  ...wholeWord.map((pattern) => ({ pattern, category, wholeWord: true })),
];

/** Standardregeln Schweiz. Reihenfolge zählt: erster Treffer gewinnt, spezifische Regeln stehen vorn. */
export const DEFAULT_RULES: Rule[] = [
  ...r(CAT.dining, ["uber eats", "coop restaurant", "migros restaurant"]),
  ...r(CAT.food, ["migros", "coop", "lidl", "aldi", "denner", "volg"], ["spar", "avec", "k kiosk"]),
  ...r(CAT.transport, ["publibike"], ["sbb", "zvv", "dott", "lime", "tier", "uber"]),
  ...r(CAT.dining, ["mcdonald", "burger king", "subway", "starbucks", "restaurant", "pizzeria", "kebab", "take away", "takeaway", "dean&david", "hiltl", "tibits"]),
  ...r(CAT.fun, ["steampowered", "netflix", "spotify", "apple.com/bill", "google play", "kino", "playstation"], ["steam"]),
  ...r(CAT.invest, ["s&p", "säule", "saeule"], ["depot", "etf"]),
  ...r(CAT.income, ["lohnzahlung", "salär", "salaer", "salary"], ["lohn"]),
];

export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s*&\s*/g, "&").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function ruleMatches(rule: Rule, text: string): boolean {
  const p = normalizeForMatch(rule.pattern);
  if (!p) return false;
  if (!rule.wholeWord) return text.includes(p);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

export interface Categorization {
  category: string;
  isMeal?: boolean;
  rule?: Rule;
}

/** Erster passender Treffer. Nutzerregeln vorn anhängen: categorize(row, [...eigene, ...DEFAULT_RULES]). */
export function categorize(row: Pick<Buchung, "description" | "counterparty">, rules: Rule[] = DEFAULT_RULES): Categorization {
  const text = normalizeForMatch(`${row.description} ${row.counterparty ?? ""}`);
  for (const rule of rules) {
    if (ruleMatches(rule, text)) return { category: rule.category, ...(rule.isMeal !== undefined ? { isMeal: rule.isMeal } : {}), rule };
  }
  return { category: CAT.other };
}

/** Setzt category (und isMeal aus der Regel) auf Kopien; manuell gesetzte Werte bleiben. */
export function applyCategories(rows: Buchung[], rules: Rule[] = DEFAULT_RULES): Buchung[] {
  return rows.map((row) => {
    const c = categorize(row, rules);
    const out: Buchung = { ...row, category: row.category ?? c.category };
    if (row.isMeal === undefined && c.isMeal !== undefined) out.isMeal = c.isMeal;
    return out;
  });
}

const PREFIXES =
  /^(?:kartenzahlung|kartenkauf|karten-?zahlung|debitkarte|debit ?card|card payment|zahlung(?: an| von)?|einkauf|kauf\/dienstleistung|kauf|belastung|lastschrift|twint|payment|pos|bezahlung|e-?banking)\b[\s:\-/]*/i;
const STOP_WORDS = new Set([
  "zürich", "zuerich", "zurich", "bern", "basel", "luzern", "lugano", "genf", "geneve", "genève", "lausanne", "winterthur", "thun", "biel", "chur", "aarau", "baden", "zug",
  "schaffhausen", "olten", "wil", "uster", "dübendorf", "opfikon", "kloten", "wallisellen", "schlieren", "dietikon", "horgen", "wädenswil", "rapperswil", "pfäffikon", "küsnacht",
  "meilen", "stäfa", "zollikon", "adliswil", "oerlikon", "altstetten", "hb", "bahnhof", "flughafen", "st.", "schweiz", "switzerland", "ch", "-", "–", "|",
]);

/** Händlername aus einer Buchungsbeschreibung, ohne Filialnummern, Ort, Datum und Kartennummern. */
export function merchantName(description: string): string {
  let s = description
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/[x*•]{2,}\s*\d{2,4}/gi, " ")
    .replace(/\b(?:karte|card|kartennr\.?|karten-nr\.?)\s*(?:nr\.?)?\s*[x*•\d ]{4,}/gi, " ")
    .replace(/\b(?:filiale|fil\.?|nr\.?|no\.?|store|shop)\s*#?\s*\d+/gi, " ")
    .replace(/#\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(PREFIXES, "").replace(/^(?:vom|am|um|mit|an|bei)\b\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  const words: string[] = [];
  for (const [i, tok] of s.split(" ").entries()) {
    if (!tok) continue;
    const bare = tok.replace(/,$/, "");
    const low = bare.toLowerCase();
    if (i > 0 && (/\d/.test(bare) || STOP_WORDS.has(low) || /^[A-Z]{2}$/.test(bare))) break;
    if (/^\d+$/.test(bare)) break;
    words.push(bare);
    if (tok.endsWith(",") || words.length >= 3) break;
  }
  return words.join(" ").replace(/[.,*\s]+$/, "").toLowerCase();
}

/** Neue Regel aus einer Korrektur (Beschreibung + gewählte Kategorie). null, wenn kein Händler erkennbar ist. */
export function learnRule(description: string, category: string): Rule | null {
  const pattern = merchantName(description);
  if (pattern.length < 2) return null;
  const rule: Rule = { pattern, category };
  if (pattern.length <= 4 && !pattern.includes(" ")) rule.wholeWord = true;
  return rule;
}
