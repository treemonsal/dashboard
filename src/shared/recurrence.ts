// Wiederholungsregeln für Aufgaben (Teilmenge von RRULE, RFC 5545) und das nächste Fälligkeitsdatum.
import { addDays, daysBetween, mondayOf, weekdayNum } from "./dates";

const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const NAMES_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const NAMES_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const WORKDAYS = [1, 2, 3, 4, 5];

/** Auswahl in der Oberfläche. */
export type Repeat =
  | { kind: "none" }
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly"; days: number[] }
  | { kind: "every"; n: number }
  | { kind: "monthly" }
  | { kind: "yearly" }
  | { kind: "other" };

const byOrder = (days: number[]) => [...new Set(days)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

/** Regeltext zur Auswahl. `dueDate` bestimmt den Wochentag bei "wöchentlich" ohne gewählte Tage. */
export function buildRule(r: Repeat, dueDate?: string | null): string | null {
  switch (r.kind) {
    case "none":
    case "other":
      return null;
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return `FREQ=WEEKLY;BYDAY=${WORKDAYS.map((d) => CODES[d]).join(",")}`;
    case "weekly": {
      const days = r.days.length ? byOrder(r.days) : dueDate ? [weekdayNum(dueDate)] : [];
      return days.length ? `FREQ=WEEKLY;BYDAY=${days.map((d) => CODES[d]).join(",")}` : "FREQ=WEEKLY";
    }
    case "every": {
      const n = Math.max(1, Math.min(365, Math.round(r.n)));
      return n === 1 ? "FREQ=DAILY" : `FREQ=DAILY;INTERVAL=${n}`;
    }
    case "monthly":
      return "FREQ=MONTHLY";
    case "yearly":
      return "FREQ=YEARLY";
  }
}

interface Parsed {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  days: number[];
  monthDay: number | null;
  until: string | null;
}

function parseRule(rule: string): Parsed | null {
  const kv: Record<string, string> = {};
  for (const part of rule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const allowed = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "UNTIL"]);
  if (Object.keys(kv).some((k) => !allowed.has(k))) return null;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(kv.FREQ)) return null;
  const interval = kv.INTERVAL ? Number(kv.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;
  const days: number[] = [];
  for (const d of kv.BYDAY ? kv.BYDAY.split(",") : []) {
    const i = CODES.indexOf(d.toUpperCase());
    if (i < 0) return null;
    days.push(i);
  }
  let monthDay: number | null = null;
  if (kv.BYMONTHDAY) {
    monthDay = Number(kv.BYMONTHDAY);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) return null;
  }
  let until: string | null = null;
  if (kv.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(kv.UNTIL);
    if (!m) return null;
    until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return { freq: kv.FREQ as Parsed["freq"], interval, days, monthDay, until };
}

/** Auswahl aus einer gespeicherten Regel; unbekannte Regeln werden "other". */
export function parseRepeat(rule: string | null | undefined): Repeat {
  if (!rule) return { kind: "none" };
  const p = parseRule(rule);
  if (!p) return { kind: "other" };
  if (p.until || p.monthDay) return { kind: "other" };
  if (p.freq === "DAILY") return p.days.length ? { kind: "other" } : p.interval === 1 ? { kind: "daily" } : { kind: "every", n: p.interval };
  if (p.freq === "WEEKLY") {
    if (p.interval !== 1) return { kind: "other" };
    const days = byOrder(p.days);
    if (days.length === 5 && WORKDAYS.every((d) => days.includes(d))) return { kind: "weekdays" };
    return { kind: "weekly", days };
  }
  if (p.interval !== 1 || p.days.length) return { kind: "other" };
  return { kind: p.freq === "MONTHLY" ? "monthly" : "yearly" };
}

/** Kurzform für die Anzeige, klein geschrieben: "täglich", "werktags", "jeden Montag", "Mo, Mi", "alle 3 Tage". */
export function describeRule(rule: string | null | undefined): string {
  const r = parseRepeat(rule);
  switch (r.kind) {
    case "none":
      return "";
    case "daily":
      return "täglich";
    case "weekdays":
      return "werktags";
    case "weekly":
      return r.days.length === 0 ? "wöchentlich" : r.days.length === 1 ? `jeden ${NAMES_LONG[r.days[0]]}` : r.days.map((d) => NAMES_SHORT[d]).join(", ");
    case "every":
      return `alle ${r.n} Tage`;
    case "monthly":
      return "monatlich";
    case "yearly":
      return "jährlich";
    case "other":
      return "wiederholt";
  }
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const clampDay = (y: number, m: number, d: number) => Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Nächstes Fälligkeitsdatum nach dem Erledigen. Ausgangspunkt ist das spätere von Fälligkeit und heute:
 * Eine überfällige Aufgabe springt in die Zukunft statt eine weitere überfällige zu erzeugen.
 * null, wenn die Regel unbekannt ist oder ihr Ende (UNTIL) überschritten wäre.
 */
export function nextDue(rule: string, dueDate: string | null, today: string): string | null {
  const p = parseRule(rule);
  if (!p) return null;
  const anchor = dueDate ?? today;
  const base = anchor > today ? anchor : today;
  let next: string | null = null;

  if (p.freq === "DAILY") {
    if (p.days.length) {
      for (let i = 1; i <= 7 && !next; i++) {
        const d = addDays(base, i);
        if (p.days.includes(weekdayNum(d))) next = d;
      }
    } else next = addDays(base, p.interval);
  } else if (p.freq === "WEEKLY") {
    if (!p.days.length) next = addDays(base, 7 * p.interval);
    else {
      const aw = mondayOf(anchor);
      for (let i = 1; i <= 7 * p.interval + 7 && !next; i++) {
        const d = addDays(base, i);
        if (!p.days.includes(weekdayNum(d))) continue;
        const weeks = Math.round(daysBetween(aw, mondayOf(d)) / 7);
        if (weeks >= 0 && weeks % p.interval === 0) next = d;
      }
    }
  } else if (p.freq === "MONTHLY") {
    const day = p.monthDay ?? Number(anchor.slice(8, 10));
    const am = monthIndex(anchor);
    for (let m = monthIndex(base); m <= monthIndex(base) + 12 * p.interval + 1 && !next; m++) {
      if ((m - am) % p.interval !== 0) continue;
      const y = Math.floor(m / 12);
      const mo = (m % 12) + 1;
      const d = ymd(y, mo, clampDay(y, mo, day));
      if (d > base) next = d;
    }
  } else {
    const mo = Number(anchor.slice(5, 7));
    const day = Number(anchor.slice(8, 10));
    for (let y = Number(base.slice(0, 4)); y <= Number(base.slice(0, 4)) + p.interval + 1 && !next; y++) {
      if ((y - Number(anchor.slice(0, 4))) % p.interval !== 0) continue;
      const d = ymd(y, mo, clampDay(y, mo, day));
      if (d > base) next = d;
    }
  }
  if (next && p.until && next > p.until) return null;
  return next;
}
