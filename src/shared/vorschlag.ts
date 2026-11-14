// Tagesplan lernt mit (erste Stufe): Uhrzeit-Vorschläge für Aufgaben ohne Uhrzeit, abgeleitet aus
// früheren Erledigungen (task_events). Reine Funktionen, ohne Zugriff auf Datenbank oder Uhr.
import { minutesOf, clockOf } from "./dates";

/** Mindestens so viele ähnliche Erledigungen am selben Wochentag, sonst kein Vorschlag. */
export const MIN_SAMPLES = 3;
/** Eine Aufgabe soll spätestens um 21:30 fertig sein. */
export const LATEST_END = 21 * 60 + 30;
/** Arbeitstage (Lehrbetrieb) sind tagsüber bis hier gesperrt. */
export const WORK_UNTIL = 17 * 60;
/** Schultage sind tagsüber bis hier gesperrt. */
export const SCHOOL_UNTIL = 16 * 60 + 30;
const DEFAULT_MIN = 30;
const STEP = 5;

export interface LearnEvent {
  title: string;
  /** 0 = Sonntag ... 6 = Samstag */
  weekday: number;
  /** "HH:MM", wann erledigt wurde */
  doneTime: string;
  durationMin: number | null;
}
export interface Interval {
  start: number;
  end: number;
}
export interface Suggestion {
  time: string;
  basedOn: number;
}

/** Titel vergleichbar machen: klein, ohne Ziffern und Satzzeichen. */
export function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-zäöüéèàß ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function similar(a: string, b: string): boolean {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Tagsüber gesperrte Zeit: Arbeitstage bis 17:00, Schultage bis 16:30, ab Aufstehzeit.
 * Gibt es einen Stundenplan (`hasTimetable`), entfällt die pauschale Schulsperre: dann sperren die Lektionen selbst
 * (sie kommen als `busy` herein), und ein schulfreier Tag oder ein Ferientag ist frei.
 */
export function dayBlock(weekday: number, workDays: number[], schoolDays: number[], wake: string, hasTimetable = false): Interval | null {
  if (workDays.includes(weekday)) return { start: minutesOf(wake), end: WORK_UNTIL };
  if (!hasTimetable && schoolDays.includes(weekday)) return { start: minutesOf(wake), end: SCHOOL_UNTIL };
  return null;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export interface SuggestInput {
  events: LearnEvent[];
  title: string;
  durationMin: number | null;
  weekday: number;
  busy: Interval[];
  workDays: number[];
  schoolDays: number[];
  wake: string;
  /** Frühester Beginn (Minuten seit Mitternacht), z.B. die aktuelle Uhrzeit heute. */
  from?: number;
  /** Es gibt einen Stundenplan: die Lektionen stehen in `busy`, die pauschale Schulsperre gilt nicht. */
  hasTimetable?: boolean;
}

/** Vorschlag für eine Aufgabe: Median der Uhrzeit ähnlicher Erledigungen am selben Wochentag, in eine freie Lücke gelegt. */
export function suggestTime(i: SuggestInput): Suggestion | null {
  const same = i.events.filter((e) => e.weekday === i.weekday && similar(e.title, i.title));
  if (same.length < MIN_SAMPLES) return null;
  const durs = same.map((e) => e.durationMin).filter((d): d is number => !!d && d > 0);
  const dur = i.durationMin ?? (durs.length ? Math.round(median(durs)) : DEFAULT_MIN);
  const want = Math.round(median(same.map((e) => minutesOf(e.doneTime))) / STEP) * STEP;
  const blocks = [...i.busy];
  const db = dayBlock(i.weekday, i.workDays, i.schoolDays, i.wake, i.hasTimetable);
  if (db) blocks.push(db);
  const lo = Math.max(minutesOf(i.wake), Math.ceil((i.from ?? 0) / STEP) * STEP);
  const free = (s: number) => s >= lo && s + dur <= LATEST_END && !blocks.some((b) => overlaps({ start: s, end: s + dur }, b));
  for (let s = Math.max(want, lo); s + dur <= LATEST_END; s += STEP) if (free(s)) return { time: clockOf(s), basedOn: same.length };
  for (let s = want - STEP; s >= lo; s -= STEP) if (free(s)) return { time: clockOf(s), basedOn: same.length };
  return null;
}

export interface DayTask {
  id: string;
  title: string;
  dueTime: string | null;
  durationMin: number | null;
  done: boolean;
}

/** Vorschläge für alle offenen Aufgaben eines Tages ohne Uhrzeit. Jeder Vorschlag belegt seine Lücke für die nächsten. */
export function suggestDay(o: { weekday: number; tasks: DayTask[]; events: LearnEvent[]; appointments: Interval[]; workDays: number[]; schoolDays: number[]; wake: string; from?: number; lessons?: Interval[] | null }): Map<string, Suggestion> {
  // `lessons` gesetzt (auch leer) = Stundenplan vorhanden: Lektionen sperren, die Pauschale entfällt.
  const hasTimetable = !!o.lessons;
  const busy: Interval[] = [...o.appointments, ...(o.lessons ?? [])];
  for (const t of o.tasks) if (t.dueTime) busy.push({ start: minutesOf(t.dueTime), end: minutesOf(t.dueTime) + (t.durationMin ?? DEFAULT_MIN) });
  const out = new Map<string, Suggestion>();
  for (const t of o.tasks) {
    if (t.dueTime || t.done) continue;
    const s = suggestTime({ events: o.events, title: t.title, durationMin: t.durationMin, weekday: o.weekday, busy, workDays: o.workDays, schoolDays: o.schoolDays, wake: o.wake, from: o.from, hasTimetable });
    if (!s) continue;
    out.set(t.id, s);
    busy.push({ start: minutesOf(s.time), end: minutesOf(s.time) + (t.durationMin ?? DEFAULT_MIN) });
  }
  return out;
}
