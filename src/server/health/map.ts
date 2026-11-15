// Zuordnung der Antworten der Google Health API (v4) zu health_daily und health_workouts. Reine Funktionen.
// Alle Tage in Europe/Zurich. Schlaf zählt zum Tag des Aufwachens (Ende der Schlafphase), nicht zum Einschlaftag.
import { todayInZone } from "../../shared/dates";
import type { DayValues, SleepNight, Workout } from "./types";

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" ? (x as Obj) : null);
/** Die API gibt int64 als Text zurück. */
const num = (x: unknown): number | null => {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
};
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** {year, month, day} oder {date:{...}} -> "YYYY-MM-DD". */
export function civilDate(x: unknown): string | null {
  const o = obj(x);
  if (!o) return null;
  const d = obj(o.date) ?? o;
  const y = num(d.year), m = num(d.month), dd = num(d.day);
  return y && m && dd ? `${pad(y, 4)}-${pad(m)}-${pad(dd)}` : null;
}

/** Zürcher Tag eines Zeitpunkts; null bei ungültiger Eingabe. */
export function zurichDay(iso: unknown): string | null {
  const s = str(iso);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : todayInZone(new Date(t));
}

/** "1800s" oder "1800.5s" -> Sekunden. */
export function durationSeconds(x: unknown): number | null {
  const s = str(x);
  const m = s && /^(-?\d+(?:\.\d+)?)s$/.exec(s);
  return m ? Number(m[1]) : null;
}

type Acc = Map<string, DayValues>;
function slot(acc: Acc, day: string): DayValues {
  let d = acc.get(day);
  if (!d) acc.set(day, (d = { day, sleepMin: null, steps: null, restingHr: null, weightKg: null }));
  return d;
}
const list = (res: unknown, key: string): Obj[] => {
  const a = obj(res)?.[key];
  return Array.isArray(a) ? a.map(obj).filter((x): x is Obj => !!x) : [];
};

/** dailyRollUp für steps: countSum je Tag. */
export function mapSteps(res: unknown, acc: Acc): void {
  for (const p of list(res, "rollupDataPoints")) {
    const day = civilDate(p.civilStartTime);
    const n = num(obj(p.steps)?.countSum);
    if (day && n !== null && n >= 0) slot(acc, day).steps = Math.round(n);
  }
}

export function mapRestingHr(res: unknown, acc: Acc): void {
  for (const p of list(res, "dataPoints")) {
    const r = obj(p.dailyRestingHeartRate);
    const day = civilDate(r?.date);
    const bpm = num(r?.beatsPerMinute);
    if (day && bpm !== null && bpm > 0) slot(acc, day).restingHr = Math.round(bpm);
  }
}

/** Mehrere Wägungen am Tag: die späteste zählt. */
export function mapWeight(res: unknown, acc: Acc): void {
  const latest = new Map<string, { t: number; kg: number }>();
  for (const p of list(res, "dataPoints")) {
    const w = obj(p.weight);
    const g = num(w?.weightGrams);
    const phys = str(obj(w?.sampleTime)?.physicalTime);
    const day = zurichDay(phys);
    if (g === null || g <= 0 || !phys || !day) continue;
    const t = Date.parse(phys);
    const cur = latest.get(day);
    if (!cur || t > cur.t) latest.set(day, { t, kg: g / 1000 });
  }
  for (const [day, v] of latest) slot(acc, day).weightKg = Math.round(v.kg * 10) / 10;
}

/**
 * Schlaf: Summe der Minuten Schlaf (ohne Wachphasen) aller Schlafphasen, die an einem Tag enden.
 * Nickerchen (metadata.nap) zählen nicht, die Nacht schon; mehrteilige Nächte (Aufwachen, wieder einschlafen) werden addiert.
 */
export function mapSleep(res: unknown, acc: Acc): void {
  const sum = new Map<string, number>();
  for (const p of list(res, "dataPoints")) {
    const s = obj(p.sleep);
    if (!s || obj(s.metadata)?.nap === true) continue;
    const day = zurichDay(obj(s.interval)?.endTime);
    let min = num(obj(s.summary)?.minutesAsleep);
    if (min === null) {
      // Ohne Zusammenfassung: Stufen ausser AWAKE zählen.
      const stages = Array.isArray(s.stages) ? s.stages.map(obj).filter((x): x is Obj => !!x) : [];
      if (stages.length) {
        let ms = 0;
        for (const g of stages) {
          if (g.type === "AWAKE" || g.type === "RESTLESS") continue;
          const a = Date.parse(String(g.startTime)), b = Date.parse(String(g.endTime));
          if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) ms += b - a;
        }
        min = Math.round(ms / 60_000);
      }
    }
    if (!day || min === null || min < 0) continue;
    sum.set(day, (sum.get(day) ?? 0) + min);
  }
  for (const [day, m] of sum) slot(acc, day).sleepMin = Math.min(1440, Math.round(m));
}

/**
 * Nächte mit Zeiten und Phasen (Felder laut Discovery-Dokument: interval.startTime/endTime, stages[].type, summary.minutesAsleep/minutesAwake).
 * Mehrere Schlafphasen am selben Aufwachtag: frühester Beginn, spätestes Ende, Minuten addiert. Nickerchen zählen nicht.
 * Phasen nur, wenn die Antwort Stufen liefert; sonst bleiben sie null.
 */
export function mapSleepNights(res: unknown): SleepNight[] {
  const by = new Map<string, SleepNight & { t0: number; t1: number }>();
  for (const p of list(res, "dataPoints")) {
    const s = obj(p.sleep);
    if (!s || obj(s.metadata)?.nap === true) continue;
    const iv = obj(s.interval);
    const start = str(iv?.startTime), end = str(iv?.endTime);
    const day = zurichDay(end);
    if (!start || !end || !day) continue;
    const a = Date.parse(start), b = Date.parse(end);
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue;
    const sum = obj(s.summary);
    const stages = Array.isArray(s.stages) ? s.stages.map(obj).filter((x): x is Obj => !!x) : [];
    const mins: Record<string, number> = {};
    for (const g of stages) {
      const ga = Date.parse(String(g.startTime)), gb = Date.parse(String(g.endTime));
      if (Number.isNaN(ga) || Number.isNaN(gb) || gb <= ga) continue;
      const k = String(g.type);
      mins[k] = (mins[k] ?? 0) + (gb - ga) / 60_000;
    }
    const has = stages.length > 0;
    const r = (k: string) => (has ? Math.round(mins[k] ?? 0) : null);
    const asleep = num(sum?.minutesAsleep);
    const awake = num(sum?.minutesAwake);
    const add = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
    const cur = by.get(day);
    const row = { day, startAt: new Date(a).toISOString(), endAt: new Date(b).toISOString(), asleepMin: asleep, awakeMin: awake ?? (has ? r("AWAKE") : null), deepMin: r("DEEP"), lightMin: r("LIGHT"), remMin: r("REM"), t0: a, t1: b };
    if (!cur) by.set(day, row);
    else {
      cur.asleepMin = add(cur.asleepMin, row.asleepMin);
      cur.awakeMin = add(cur.awakeMin, row.awakeMin);
      cur.deepMin = add(cur.deepMin, row.deepMin);
      cur.lightMin = add(cur.lightMin, row.lightMin);
      cur.remMin = add(cur.remMin, row.remMin);
      if (a < cur.t0) { cur.t0 = a; cur.startAt = row.startAt; }
      if (b > cur.t1) { cur.t1 = b; cur.endAt = row.endAt; }
    }
  }
  return [...by.values()].map(({ t0: _a, t1: _b, ...n }) => n).sort((x, y) => x.day.localeCompare(y.day));
}

export function mapExercise(res: unknown, id: (startIso: string) => string): Workout[] {
  const out: Workout[] = [];
  for (const p of list(res, "dataPoints")) {
    const e = obj(p.exercise);
    const iv = obj(e?.interval);
    const start = str(iv?.startTime);
    const day = zurichDay(start);
    const type = str(e?.exerciseType);
    if (!e || !start || !day || !type) continue;
    const end = str(iv?.endTime);
    const active = durationSeconds(e.activeDuration);
    const span = end && !Number.isNaN(Date.parse(end)) ? (Date.parse(end) - Date.parse(start)) / 1000 : null;
    const secs = active ?? span;
    const m = obj(e.metricsSummary);
    const kcal = num(m?.caloriesKcal);
    const hr = num(m?.averageHeartRateBeatsPerMinute);
    out.push({
      id: id(start),
      day,
      startAt: new Date(start).toISOString(),
      endAt: end ? new Date(end).toISOString() : null,
      type,
      name: str(e.displayName),
      minutes: secs !== null && secs >= 0 ? Math.round(secs / 60) : null,
      kcal: kcal !== null ? Math.round(kcal) : null,
      avgHr: hr !== null ? Math.round(hr) : null,
    });
  }
  return out;
}

export function toDays(acc: Acc): DayValues[] {
  return [...acc.values()].sort((a, b) => a.day.localeCompare(b.day));
}
export type { Acc };
