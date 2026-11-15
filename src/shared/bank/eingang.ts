// Eingang per Kurzbefehl: Betrag erkennen und Händlernamen säubern. Reine Funktionen.
import { parseAmount } from "./num";

export interface Betrag {
  /** Rappen, vorzeichenbehaftet wie geschrieben */
  rappen: number;
  /** Währung, wenn im Text angegeben, sonst null */
  currency: string | null;
}

const CODES = "CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD|TRY";
const SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
const LEAD = new RegExp(`^(${CODES}|s?fr\\.?|[€$£])\\s*`, "i");
const TAIL = new RegExp(`\\s*(${CODES}|s?fr\\.?|[€$£])$`, "i");

function currencyOf(token: string): string {
  const t = token.toUpperCase();
  if (SYMBOLS[t]) return SYMBOLS[t]!;
  if (/^S?FR\.?$/.test(t)) return "CHF";
  return t;
}

/**
 * Betrag aus einer Zahl oder aus Text wie "CHF 12.50", "12,50 CHF", "Fr. 12.50", "1'234.50", "€ 3,20".
 * Gibt null zurück, wenn etwas anderes als Zahl und höchstens eine Währung im Text steht.
 */
export function parseBetrag(input: unknown): Betrag | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || Math.abs(input) > 1e9) return null;
    return { rappen: Math.round(input * 100), currency: null };
  }
  if (typeof input !== "string") return null;
  let s = input.replace(/[  ]/g, " ").trim();
  if (!s || s.length > 40) return null;
  let currency: string | null = null;
  const lead = LEAD.exec(s);
  if (lead) {
    currency = currencyOf(lead[1]!);
    s = s.slice(lead[0].length);
  }
  const tail = TAIL.exec(s);
  if (tail) {
    // Währung nur einmal angeben
    if (currency) return null;
    currency = currencyOf(tail[1]!);
    s = s.slice(0, tail.index);
  }
  s = s.trim();
  if (!/^[+\-−]?\s*\d[\d'’ .,]*$/.test(s)) return null;
  const rappen = parseAmount(s);
  if (rappen === null) return null;
  return { rappen, currency };
}

/** Händlername aus dem Kurzbefehl: Steuerzeichen und Zeilenumbrüche weg, Leerraum zusammenfassen. */
export function cleanMerchant(input: string): string {
  return input.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Schlüssel für den Doppel-Schutz: gleicher Händler (ohne Gross/Klein und Leerraum), Betrag, Währung und Konto. */
export function dedupeKey(parts: { merchant: string; rappen: number; currency: string; account: string }): string {
  return [parts.account, parts.rappen, parts.currency, cleanMerchant(parts.merchant).toLowerCase()].join("|");
}
