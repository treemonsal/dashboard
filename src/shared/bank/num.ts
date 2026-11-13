// Zahlen- und Datumsformate.

/** Kaufmännisch runden (x.5 weg von null). */
export function roundHalfUp(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * Betrag als Rappen (Ganzzahl) lesen. Versteht 1'234.50, 1.234,50, 1,234.50, 1234.5, -12,30,
 * 12.30-, (12.30), "CHF 12.30". Bei einem einzelnen Trennzeichen gilt "." immer als Dezimalpunkt,
 * "," als Dezimalkomma ausser bei genau drei Nachkommastellen (dann Tausender: 1,234).
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/−/g, "-").trim();
  if (!s) return null;
  const hasApos = /['’ʼ´`]/.test(s);
  s = s.replace(/[\s  '’ʼ´`]/g, "").replace(/^[A-Za-z€$£]+|[A-Za-z€$£]+$/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let dec: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? "." : ",";
  else if (lastDot >= 0) {
    if (s.split(".").length === 2) dec = ".";
  } else if (lastComma >= 0 && s.split(",").length === 2) {
    const after = s.length - lastComma - 1;
    const thousands = after === 3 && lastComma > 0 && lastComma <= 3 && !hasApos;
    if (!thousands) dec = ",";
  }
  let intPart = s;
  let frac = "";
  if (dec) {
    const i = s.lastIndexOf(dec);
    intPart = s.slice(0, i);
    if (intPart.includes(dec)) return null;
    frac = s.slice(i + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const value = Math.round(parseFloat((intPart || "0") + "." + (frac || "0")) * 100);
  if (!Number.isFinite(value)) return null;
  return neg ? -value : value;
}

export interface ParsedDate {
  date: string;
  time?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, jeweils mit oder ohne Uhrzeit. */
export function parseDate(input: string): ParsedDate | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let rest: RegExpMatchArray | null = null;
  let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (mm) {
    y = +mm[1]!;
    m = +mm[2]!;
    d = +mm[3]!;
    rest = mm.slice(4) as unknown as RegExpMatchArray;
  } else {
    mm = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!mm) return null;
    d = +mm[1]!;
    m = +mm[2]!;
    y = +mm[3]!;
    if (mm[3]!.length === 2) y += 2000;
    rest = mm.slice(4) as unknown as RegExpMatchArray;
  }
  if (!valid(y, m, d)) return null;
  const out: ParsedDate = { date: `${y}-${pad(m)}-${pad(d)}` };
  if (rest[0] !== undefined) {
    const hh = +rest[0];
    const mi = +(rest[1] ?? 0);
    if (hh > 23 || mi > 59) return null;
    out.time = `${pad(hh)}:${pad(mi)}` + (rest[2] !== undefined ? `:${pad(+rest[2])}` : "");
  }
  return out;
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function diffDays(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(a) - ms(b)) / 86400000);
}
