// Schlanker iCal-Leser (RFC 5545) ohne Abhängigkeit. Liest VEVENT, rollt Wiederholungen für ein Zeitfenster aus
// und liefert Termine in lokaler Zürcher Zeit (Datum "YYYY-MM-DD", Zeit "HH:MM"), wie die übrige App.
//
// Unterstützt: Zeilenfaltung, Textmaskierung, DTSTART/DTEND/DURATION als Datum, UTC, mit TZID und schwebend,
// RRULE (DAILY, WEEKLY, MONTHLY, YEARLY mit INTERVAL, BYDAY inkl. Ordnungszahl, BYMONTHDAY, BYMONTH, COUNT, UNTIL, WKST),
// EXDATE, RECURRENCE-ID (verschobene Einzeltermine), STATUS:CANCELLED.
// Nicht unterstützt (der Termin erscheint dann nur einmal und wird in `unsupported` gezählt):
// BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR/BYMINUTE/BYSECOND, FREQ kürzer als DAILY, RDATE.
import { ZONE, addDays, daysBetween, isValidZone, localInZone, weekdayNum, zoneLocalToUtcMs } from "./dates";

export class IcsError extends Error {}

export interface IcsEvent {
  uid: string;
  /** Eindeutig je Termin und Vorkommen innerhalb eines Kalenders. */
  key: string;
  title: string;
  startDate: string;
  startTime: string | null;
  /** Ganztägig: letzter Tag (inklusive). Sonst Tag des Endes. */
  endDate: string;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
}

export interface IcsResult {
  events: IcsEvent[];
  /** Anzahl VEVENT im Text (ohne Auswahl). */
  total: number;
  /** Termine mit Wiederholungsregel, die der Leser nicht kennt. */
  unsupported: number;
}

export interface IcsWindow {
  /** Erster und letzter Tag (lokal), für die Vorkommen erzeugt werden. */
  from: string;
  to: string;
}

/* ---------- Zeilen ---------- */

interface Prop {
  params: Record<string, string>;
  value: string;
}
type Raw = Map<string, Prop[]>;

export function unfold(text: string): string[] {
  return text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function splitUnquoted(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  let q = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === ":" && !q) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const [name, ...ps] = splitUnquoted(line.slice(0, colon), ";");
  const params: Record<string, string> = {};
  for (const p of ps) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), prop: { params, value: line.slice(colon + 1) } };
}

export const unescapeText = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/* ---------- Zeitangaben ---------- */

/** Wandzeit in einer Zone: Datum, Minuten seit Mitternacht (null = nur Datum) und die Zone, in der sie gilt. */
interface Stamp {
  date: string;
  minutes: number | null;
  zone: string;
}

const WINDOWS_ZONES: Record<string, string> = {
  "W. Europe Standard Time": ZONE,
  "Central Europe Standard Time": ZONE,
  "Romance Standard Time": ZONE,
  "Central European Standard Time": ZONE,
};

function zoneOf(tzid: string | undefined): string {
  if (!tzid) return ZONE;
  const t = tzid.replace(/^\//, "");
  if (WINDOWS_ZONES[t]) return WINDOWS_ZONES[t];
  return isValidZone(t) ? t : ZONE;
}

function parseStamp(p: Prop): Stamp | null {
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(v);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (Number.isNaN(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) return null;
  if (m[4] === undefined || p.params.VALUE === "DATE") return { date, minutes: null, zone: ZONE };
  const minutes = Number(m[4]) * 60 + Number(m[5]);
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return null;
  return { date, minutes, zone: m[7] ? "UTC" : zoneOf(p.params.TZID) };
}

const stampMs = (s: Stamp) => zoneLocalToUtcMs(s.date, s.minutes ?? 0, s.zone);

/** "P1D", "PT1H30M", "P1W", "-PT15M" in Millisekunden. */
function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v.trim());
  if (!m) return null;
  const n = (x: string | undefined) => (x ? Number(x) : 0);
  const ms = ((n(m[2]) * 7 + n(m[3])) * 86400 + n(m[4]) * 3600 + n(m[5]) * 60 + n(m[6])) * 1000;
  return m[1] === "-" ? -ms : ms;
}

/* ---------- Wiederholungsregel ---------- */

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
interface Rule {
  freq: Freq;
  interval: number;
  count: number | null;
  until: Stamp | null;
  untilUtc: boolean;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
  wkst: number;
}

const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const UNSUPPORTED_PARTS = ["BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYHOUR", "BYMINUTE", "BYSECOND"];

/** null = Regel nicht lesbar oder nicht unterstützt. */
function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(kv.FREQ)) return null;
  if (UNSUPPORTED_PARTS.some((k) => k in kv)) return null;
  const interval = kv.INTERVAL ? Number(kv.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1) return null;
  const count = kv.COUNT ? Number(kv.COUNT) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  const byDay: Rule["byDay"] = [];
  for (const d of kv.BYDAY ? kv.BYDAY.split(",") : []) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(d.trim());
    if (!m) return null;
    byDay.push({ n: m[1] ? Number(m[1]) : 0, wd: WD[m[2].toUpperCase()] });
  }
  const nums = (s: string | undefined) => (s ? s.split(",").map(Number) : []);
  const byMonthDay = nums(kv.BYMONTHDAY);
  const byMonth = nums(kv.BYMONTH);
  if ([...byMonthDay, ...byMonth].some((n) => !Number.isInteger(n) || n === 0)) return null;
  if (byMonth.some((n) => n < 1 || n > 12)) return null;
  const freq = kv.FREQ as Freq;
  // Jahres-Ordnungszahl (z.B. 20MO im Jahr) kennen wir nicht.
  if (freq === "YEARLY" && byDay.some((d) => d.n !== 0) && byMonth.length === 0) return null;
  let until: Stamp | null = null;
  let untilUtc = false;
  if (kv.UNTIL) {
    until = parseStamp({ params: {}, value: kv.UNTIL });
    if (!until) return null;
    untilUtc = /Z$/i.test(kv.UNTIL);
  }
  return { freq, interval, count, until, untilUtc, byDay, byMonthDay, byMonth, wkst: kv.WKST && kv.WKST.toUpperCase() in WD ? WD[kv.WKST.toUpperCase()] : 1 };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const monthLen = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Tage eines Monats nach BYMONTHDAY/BYDAY, sonst der Tag von `startDay`. Aufsteigend. */
function monthDays(rule: Rule, y: number, m: number, startDay: number): number[] {
  const len = monthLen(y, m);
  let days: number[];
  if (rule.byMonthDay.length) {
    days = rule.byMonthDay.map((d) => (d > 0 ? d : len + 1 + d)).filter((d) => d >= 1 && d <= len);
    if (rule.byDay.length) {
      const wds = new Set(rule.byDay.map((x) => x.wd));
      days = days.filter((d) => wds.has(weekdayNum(iso(y, m, d))));
    }
  } else if (rule.byDay.length) {
    days = [];
    for (const { n, wd } of rule.byDay) {
      const all: number[] = [];
      for (let d = 1; d <= len; d++) if (weekdayNum(iso(y, m, d)) === wd) all.push(d);
      if (n === 0) days.push(...all);
      else {
        const pick = n > 0 ? all[n - 1] : all[all.length + n];
        if (pick !== undefined) days.push(pick);
      }
    }
  } else days = startDay <= len ? [startDay] : [];
  return [...new Set(days)].sort((a, b) => a - b);
}

const MAX_STEPS = 40_000;

/**
 * Alle Vorkommen (als Datum in der Zone des Termins) ab `start` bis `limit`, aufsteigend.
 * COUNT zählt ab dem ersten Vorkommen, auch vor dem Fenster. `ok(date)` prüft UNTIL; false beendet.
 */
function occurrenceDates(rule: Rule, start: string, limit: string, ok: (date: string) => boolean): string[] {
  const out: string[] = [];
  let steps = 0;
  const push = (d: string): boolean => {
    if (d < start) return true;
    if (d > limit || !ok(d)) return false;
    out.push(d);
    return !(rule.count !== null && out.length >= rule.count);
  };
  const [sy, sm, sd] = start.split("-").map(Number);
  const wds = new Set(rule.byDay.map((x) => x.wd));
  const months = new Set(rule.byMonth);
  const monthOk = (d: string) => months.size === 0 || months.has(Number(d.slice(5, 7)));

  if (rule.freq === "DAILY") {
    for (let d = start; steps++ < MAX_STEPS && d <= limit; d = addDays(d, rule.interval)) {
      if (wds.size && !wds.has(weekdayNum(d))) continue;
      if (!monthOk(d)) continue;
      if (rule.byMonthDay.length) {
        const [y, m, day] = d.split("-").map(Number);
        const len = monthLen(y, m);
        if (!rule.byMonthDay.some((x) => (x > 0 ? x : len + 1 + x) === day)) continue;
      }
      if (!push(d)) break;
    }
  } else if (rule.freq === "WEEKLY") {
    const days = wds.size ? [...wds] : [weekdayNum(start)];
    const offsets = days.map((wd) => (wd - rule.wkst + 7) % 7).sort((a, b) => a - b);
    const weekStart = addDays(start, -((weekdayNum(start) - rule.wkst + 7) % 7));
    outer: for (let w = weekStart; steps++ < MAX_STEPS && w <= limit; w = addDays(w, 7 * rule.interval)) {
      for (const o of offsets) {
        const d = addDays(w, o);
        if (d < start) continue;
        if (!monthOk(d)) continue;
        if (!push(d)) break outer;
        if (d > limit) break outer;
      }
    }
  } else if (rule.freq === "MONTHLY") {
    outer: for (let i = 0; steps++ < MAX_STEPS; i += rule.interval) {
      const total = sy * 12 + (sm - 1) + i;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (iso(y, m, 1) > limit) break;
      if (months.size && !months.has(m)) continue;
      for (const d of monthDays(rule, y, m, sd)) if (!push(iso(y, m, d))) break outer;
    }
  } else {
    const ms = rule.byMonth.length ? [...rule.byMonth].sort((a, b) => a - b) : [sm];
    outer: for (let i = 0; steps++ < MAX_STEPS; i += rule.interval) {
      const y = sy + i;
      if (iso(y, 1, 1) > limit) break;
      for (const m of ms) for (const d of monthDays(rule, y, m, sd)) if (!push(iso(y, m, d))) break outer;
    }
  }
  return out;
}

/* ---------- Termine ---------- */

interface Series {
  uid: string;
  raw: Raw;
  start: Stamp;
  /** Dauer: ganze Tage (ganztägig) oder Millisekunden. */
  durDays: number;
  durMs: number;
  allDay: boolean;
}

const first = (raw: Raw, name: string) => raw.get(name)?.[0];
const text = (raw: Raw, name: string): string | null => {
  const v = first(raw, name)?.value;
  const t = v === undefined ? "" : unescapeText(v).trim();
  return t ? t : null;
};

function series(uid: string, raw: Raw): Series | null {
  const ds = first(raw, "DTSTART");
  const start = ds && parseStamp(ds);
  if (!start) return null;
  const allDay = start.minutes === null;
  let durDays = 1;
  let durMs = 0;
  const de = first(raw, "DTEND");
  const end = de && parseStamp(de);
  const dur = first(raw, "DURATION");
  if (end) {
    if (allDay) durDays = Math.max(1, daysBetween(start.date, end.date));
    else durMs = Math.max(0, stampMs(end.minutes === null ? { ...end, minutes: 0, zone: start.zone } : end) - stampMs(start));
  } else if (dur) {
    const ms = parseDuration(dur.value);
    if (ms !== null && ms >= 0) {
      if (allDay) durDays = Math.max(1, Math.round(ms / 86_400_000));
      else durMs = ms;
    }
  }
  return { uid, raw, start, durDays, durMs, allDay };
}

function toEvent(s: Series, occDate: string, key: string): IcsEvent {
  const base = {
    uid: s.uid,
    key,
    title: text(s.raw, "SUMMARY") ?? "(ohne Titel)",
    location: text(s.raw, "LOCATION"),
    description: text(s.raw, "DESCRIPTION"),
  };
  if (s.allDay) {
    return { ...base, startDate: occDate, startTime: null, endDate: addDays(occDate, s.durDays - 1), endTime: null, allDay: true };
  }
  const startMs = zoneLocalToUtcMs(occDate, s.start.minutes!, s.start.zone);
  const a = localInZone(startMs);
  const b = localInZone(startMs + s.durMs);
  return { ...base, startDate: a.date, startTime: clock(a.minutes), endDate: b.date, endTime: clock(b.minutes), allDay: false };
}

const clock = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Letzter Tag, an dem der Termin noch läuft (Ende um Mitternacht zählt noch zum Vortag). */
export function lastDay(e: { startDate: string; startTime: string | null; endDate: string; endTime: string | null; allDay: boolean }): string {
  if (!e.allDay && e.endTime === "00:00" && e.endDate > e.startDate) return addDays(e.endDate, -1);
  return e.endDate < e.startDate ? e.startDate : e.endDate;
}

function overlaps(e: IcsEvent, w: IcsWindow): boolean {
  return e.startDate <= w.to && lastDay(e) >= w.from;
}

/** Schlüssel eines Vorkommens zum Abgleich mit EXDATE und RECURRENCE-ID. */
function matcher(list: Stamp[], s: Series) {
  const dates = new Set(list.filter((x) => x.minutes === null).map((x) => x.date));
  const times = new Set(list.filter((x) => x.minutes !== null).map(stampMs));
  return (occDate: string): boolean => {
    if (dates.has(occDate)) return true;
    if (times.size === 0 || s.allDay) return false;
    return times.has(zoneLocalToUtcMs(occDate, s.start.minutes!, s.start.zone));
  };
}

function stampsOf(raw: Raw, name: string): Stamp[] {
  const out: Stamp[] = [];
  for (const p of raw.get(name) ?? []) {
    for (const v of p.value.split(",")) {
      const st = parseStamp({ params: p.params, value: v });
      if (st) out.push(st);
    }
  }
  return out;
}

/** Liest einen iCal-Text und liefert die Vorkommen im Fenster, nach Beginn sortiert. */
export function parseIcs(input: string, window: IcsWindow): IcsResult {
  const lines = unfold(input);
  if (!lines.some((l) => /^BEGIN:VCALENDAR\s*$/i.test(l))) throw new IcsError("Keine Kalenderdatei");

  const rawEvents: Raw[] = [];
  let cur: Raw | null = null;
  let alarm = 0;
  for (const line of lines) {
    const u = line.trim().toUpperCase();
    if (u === "BEGIN:VEVENT") {
      cur = new Map();
      alarm = 0;
    } else if (u === "END:VEVENT") {
      if (cur) rawEvents.push(cur);
      cur = null;
    } else if (cur) {
      if (u === "BEGIN:VALARM") alarm++;
      else if (u === "END:VALARM") alarm = Math.max(0, alarm - 1);
      else if (alarm === 0) {
        const p = parseLine(line);
        if (p) cur.set(p.name, [...(cur.get(p.name) ?? []), p.prop]);
      }
    }
  }

  const byUid = new Map<string, { master?: Raw; overrides: Raw[] }>();
  rawEvents.forEach((raw, i) => {
    const uid = first(raw, "UID")?.value.trim() || `ohne-uid-${i}`;
    const g = byUid.get(uid) ?? { overrides: [] };
    if (first(raw, "RECURRENCE-ID")) g.overrides.push(raw);
    else g.master = g.master ?? raw;
    byUid.set(uid, g);
  });

  const out = new Map<string, IcsEvent>();
  let unsupported = 0;
  const cancelled = (raw: Raw) => text(raw, "STATUS")?.toUpperCase() === "CANCELLED";
  const add = (e: IcsEvent) => {
    if (overlaps(e, window)) out.set(`${e.uid}\u0000${e.key}`, e);
  };

  for (const [uid, g] of byUid) {
    const overrideSeries = g.overrides.map((raw) => ({ raw, s: series(uid, raw), rid: first(raw, "RECURRENCE-ID") && parseStamp(first(raw, "RECURRENCE-ID")!) }));

    if (g.master && !cancelled(g.master)) {
      const s = series(uid, g.master);
      if (s) {
        const rr = first(g.master, "RRULE");
        const rule = rr ? parseRule(rr.value) : null;
        if (rr && !rule) unsupported++;
        if (!rule) {
          // Einzeltermin (oder Regel unbekannt: nur der erste Termin)
          add(toEvent(s, s.start.date, `${s.start.date}T${s.start.minutes ?? ""}`));
        } else {
          const ex = matcher(stampsOf(g.master, "EXDATE"), s);
          const overridden = matcher(overrideSeries.flatMap((o) => (o.rid ? [o.rid] : [])), s);
          // Puffer von zwei Tagen wegen Zonenverschiebung zwischen Termin-Zone und Zürich.
          const limit = addDays(window.to, 2);
          const until = rule.until;
          const untilOk = (d: string): boolean => {
            if (!until) return true;
            if (s.allDay) return d <= until.date;
            const ms = until.minutes === null ? zoneLocalToUtcMs(addDays(until.date, 1), 0, s.start.zone) - 1 : stampMs(rule.untilUtc ? until : { ...until, zone: s.start.zone });
            return zoneLocalToUtcMs(d, s.start.minutes!, s.start.zone) <= ms;
          };
          for (const d of occurrenceDates(rule, s.start.date, limit, untilOk)) {
            if (ex(d) || overridden(d)) continue;
            add(toEvent(s, d, `${d}T${s.start.minutes ?? ""}`));
          }
        }
      }
    }

    for (const o of overrideSeries) {
      if (!o.s || cancelled(o.raw)) continue;
      const rid = o.rid;
      const key = rid ? `${rid.date}T${rid.minutes ?? ""}@${rid.minutes === null ? "" : stampMs(rid)}` : `${o.s.start.date}T${o.s.start.minutes ?? ""}`;
      add(toEvent(o.s, o.s.start.date, key));
    }
  }

  const events = [...out.values()].sort((a, b) => (a.startDate + (a.startTime ?? "")).localeCompare(b.startDate + (b.startTime ?? "")) || a.title.localeCompare(b.title));
  return { events, total: rawEvents.length, unsupported };
}
