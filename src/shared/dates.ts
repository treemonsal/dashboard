// Datumslogik für Europe/Zurich. Kalenderdaten werden als "YYYY-MM-DD" gespeichert (lokales Datum),
// Uhrzeiten als "HH:MM" (lokale Zeit). So bleibt ein Termin am selben Tag, egal wo der Server läuft.

export const ZONE = "Europe/Zurich";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Ungültiges Datum: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function utcDay(date: string): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

/** Heutiges Datum in Zürich als "YYYY-MM-DD". */
export function todayInZone(now: Date = new Date(), zone: string = ZONE): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(now);
}

/** Ganze Kalendertage von a nach b (b - a). Sommerzeit spielt keine Rolle, weil nur Daten verglichen werden. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcDay(b) - utcDay(a)) / DAY_MS);
}

/** Tage bis zu einem Datum, gezählt ab heute in Zürich. 0 = heute, negativ = vorbei. */
export function daysUntil(date: string, now: Date = new Date()): number {
  return daysBetween(todayInZone(now), date);
}

export function addDays(date: string, n: number): string {
  return new Date(utcDay(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/** UTC-Zeitpunkt (ISO) von Mitternacht eines Zürcher Datums. */
export function zoneMidnightUtc(date: string, zone: string = ZONE): string {
  const guess = utcDay(date);
  // Versatz der Zone zu diesem Zeitpunkt bestimmen und zweimal angleichen (Sommerzeitwechsel).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(new Date(t), zone);
    t = guess - offset;
  }
  return new Date(t).toISOString();
}

function zoneOffsetMs(at: Date, zone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** ISO-Kalenderwoche. */
export function isoWeek(date: string): number {
  const t = new Date(utcDay(date));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
}

const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function weekdayLong(date: string): string {
  return WEEKDAYS_LONG[new Date(utcDay(date)).getUTCDay()];
}

/** "13. November" */
export function dayMonthLong(date: string): string {
  const [, m, d] = parts(date);
  return `${d}. ${MONTHS[m - 1]}`;
}

/** "Fr 27.11." */
export function dayShort(date: string): string {
  const [, m, d] = parts(date);
  return `${WEEKDAYS_SHORT[new Date(utcDay(date)).getUTCDay()]} ${d}.${m}.`;
}

const WORDS = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];

/** Zahlwort für kleine Zahlen, sonst Ziffern. "eins" wird vor Nomen zu "einer/einem" – das regelt der Aufrufer. */
export function numberWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

/** "heute", "morgen", "in 1 Tag", "in 14 Tagen" */
export function inDays(n: number): string {
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n < 0) return n === -1 ? "gestern" : `vor ${-n} Tagen`;
  return `in ${n} Tagen`;
}

export interface DatedItem {
  date: string;
}

/**
 * Häufung nach der nächsten Prüfung: alle weiteren Prüfungen, die innerhalb von `window` Tagen
 * nach der zweiten liegen. Liefert null, wenn danach weniger als zwei Prüfungen dicht beieinander liegen.
 */
export function clusterAfterNext<T extends DatedItem>(sortedUpcoming: T[], window = 10): { count: number; spanDays: number } | null {
  const rest = sortedUpcoming.slice(1);
  if (rest.length < 2) return null;
  const first = rest[0].date;
  const inWindow = rest.filter((e) => daysBetween(first, e.date) <= window);
  if (inWindow.length < 2) return null;
  return { count: inWindow.length, spanDays: daysBetween(first, inWindow[inWindow.length - 1].date) };
}

/** 0 = Sonntag ... 6 = Samstag */
export function weekdayNum(date: string): number {
  return new Date(utcDay(date)).getUTCDay();
}

/** Aktuelle Uhrzeit in Zürich als "HH:MM". */
export function timeInZone(now: Date = new Date(), zone: string = ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** "HH:MM" in Minuten seit Mitternacht. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function clockOf(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Montag der Woche, in der `date` liegt. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayNum(date) + 6) % 7));
}

export function monthLong(m: number): string {
  return MONTHS[m - 1];
}

/** "Mo 9. Nov" */
export function dayCompact(date: string): string {
  const [, m, d] = parts(date);
  return `${WEEKDAYS_SHORT[weekdayNum(date)]} ${d}. ${MONTHS[m - 1].slice(0, 3)}`;
}

export const WEEKDAY_LETTERS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
/** Anzeigereihenfolge Montag zuerst */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
