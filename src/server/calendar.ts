// Kalender (nur lesen): geheime iCal-Adresse von Google Kalender abrufen und Termine in D1 ablegen.
// Die Adresse ist ein Zugangsschlüssel: sie wird nie geloggt, nie exportiert und nie an die Oberfläche geschickt.
import type { Hono } from "hono";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { calendarCreate, calendarEventQuery, type CalendarEvent, type CalendarInfo, type CalendarSyncResult } from "../shared/schemas";
import { checkCalendarUrl, maskCalendarUrl } from "../shared/calendar-url";
import { addDays, todayInZone } from "../shared/dates";
import { IcsError, parseIcs } from "../shared/ics";
import { idParam, newId, notFound, v, type AppEnv, type Bindings, type Db } from "./util";

const { calendars, calendarEvents, syncRuns } = schema;

export const PAST_DAYS = 14;
export const FUTURE_DAYS = 120;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 2500;
const MAX_HOPS = 3;
/** Ein Datensatz hat 10 gebundene Werte, D1 erlaubt höchstens 100 pro Anweisung. */
const ROWS_PER_INSERT = 8;

export interface SyncDeps {
  fetcher?: typeof fetch;
  now?: Date;
}

class FetchProblem extends Error {}

/** Holt den Kalender. Weiterleitungen nur wieder auf erlaubte Adressen. Meldungen enthalten nie die Adresse. */
async function download(url: string, allowLocal: boolean, fetcher: typeof fetch): Promise<string> {
  let target = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetcher(target, { redirect: "manual", headers: { accept: "text/calendar, text/plain;q=0.8" }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new FetchProblem((e as Error)?.name === "TimeoutError" ? "Zeitüberschreitung" : "Keine Verbindung");
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const loc = res.headers.get("location");
      const next = loc ? checkCalendarUrl(new URL(loc, target).toString(), allowLocal) : null;
      if (!next || !next.ok) throw new FetchProblem("Weiterleitung nicht erlaubt");
      target = next.url;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new FetchProblem(res.status === 404 || res.status === 403 || res.status === 410 ? `Adresse wird nicht akzeptiert (HTTP ${res.status})` : `Fehler beim Abruf (HTTP ${res.status})`);
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) {
      await res.body?.cancel();
      throw new FetchProblem("Datei zu gross");
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new FetchProblem("Datei zu gross");
    return text;
  }
  throw new FetchProblem("Zu viele Weiterleitungen");
}

const cut = (s: string | null, n: number) => (s && s.length > n ? s.slice(0, n) : s);

/** Gleicht alle Kalender ab. Schreibt immer einen Eintrag in sync_runs (ausser es gibt keinen Kalender). */
export async function syncCalendars(env: Bindings, deps: SyncDeps = {}): Promise<CalendarSyncResult> {
  const db: Db = drizzle(env.DB, { schema });
  const list = await db.select().from(calendars).orderBy(asc(calendars.sortOrder), asc(calendars.createdAt));
  if (!list.length) return { ok: true, message: "Kein Kalender eingetragen", events: 0 };

  const today = todayInZone(deps.now);
  const window = { from: addDays(today, -PAST_DAYS), to: addDays(today, FUTURE_DAYS) };
  const fetcher = deps.fetcher ?? fetch;
  const allowLocal = env.CALENDAR_ALLOW_LOCAL === "1";
  let total = 0;
  let unsupported = 0;
  const problems: string[] = [];

  for (const cal of list) {
    try {
      const chk = checkCalendarUrl(cal.url, allowLocal);
      if (!chk.ok) throw new FetchProblem("Adresse nicht erlaubt");
      const text = await download(chk.url, allowLocal, fetcher);
      let parsed;
      try {
        parsed = parseIcs(text, window);
      } catch (e) {
        throw new FetchProblem(e instanceof IcsError ? "Antwort ist keine Kalenderdatei" : "Kalender nicht lesbar");
      }
      const events = parsed.events.slice(0, MAX_EVENTS);
      const rows = events.map((e) => ({
        id: `${cal.id}:${e.uid}:${e.key}`,
        calendarId: cal.id,
        uid: e.uid,
        title: cut(e.title, 300)!,
        startDate: e.startDate,
        startTime: e.startTime,
        endDate: e.endDate,
        endTime: e.endTime,
        allDay: e.allDay,
        location: cut(e.location, 300),
        description: cut(e.description, 4000),
      }));
      const stmts = [db.delete(calendarEvents).where(eq(calendarEvents.calendarId, cal.id))];
      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) stmts.push(db.insert(calendarEvents).values(rows.slice(i, i + ROWS_PER_INSERT)) as never);
      await db.batch(stmts as [(typeof stmts)[0], ...typeof stmts]);
      total += rows.length;
      unsupported += parsed.unsupported;
    } catch (e) {
      const reason = e instanceof FetchProblem ? e.message : "Unerwarteter Fehler";
      // Nur Name und Grund, nie die Adresse.
      console.error(`Kalender-Abgleich fehlgeschlagen: ${cal.name}: ${reason}`);
      problems.push(`${cal.name}: ${reason}`);
    }
  }

  const ok = problems.length === 0;
  let message = ok ? `${total} ${total === 1 ? "Termin" : "Termine"}` : problems.join("; ");
  if (!ok && total > 0) message += `. Übrige: ${total} Termine`;
  if (unsupported > 0) message += `. ${unsupported} ${unsupported === 1 ? "Termin" : "Termine"} mit nicht unterstützter Wiederholung nur einmal`;
  await db.insert(syncRuns).values({ id: newId(), kind: "kalender", ok, message: message.slice(0, 500) });
  return { ok, message, events: total };
}

const info = (r: typeof calendars.$inferSelect): CalendarInfo => ({ id: r.id, name: r.name, urlMasked: maskCalendarUrl(r.url) });

export function registerCalendar(api: Hono<AppEnv>) {
  api.get("/calendars", async (c) => {
    const rows = await c.var.db.select().from(calendars).orderBy(asc(calendars.sortOrder), asc(calendars.createdAt));
    return c.json(rows.map(info));
  });
  api.post("/calendars", v("json", calendarCreate), async (c) => {
    const b = c.req.valid("json");
    const chk = checkCalendarUrl(b.url, c.env.CALENDAR_ALLOW_LOCAL === "1");
    if (!chk.ok) return c.json({ error: chk.reason }, 400);
    const max = (await c.var.db.select({ s: calendars.sortOrder }).from(calendars).orderBy(asc(calendars.sortOrder))).at(-1)?.s ?? -1;
    const row = await c.var.db.insert(calendars).values({ id: b.id ?? newId(), name: b.name, url: chk.url, sortOrder: max + 1 }).returning().get();
    return c.json(info(row), 201);
  });
  api.delete("/calendars/:id", v("param", idParam), async (c) => {
    const row = await c.var.db.delete(calendars).where(eq(calendars.id, c.req.valid("param").id)).returning({ id: calendars.id }).get();
    return row ? c.json({ ok: true }) : notFound(c);
  });
  api.post("/calendar/sync", async (c) => c.json(await syncCalendars(c.env)));
  api.get("/calendar/events", v("query", calendarEventQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    const rows = await c.var.db
      .select({ e: calendarEvents, calendarName: calendars.name })
      .from(calendarEvents)
      .innerJoin(calendars, eq(calendars.id, calendarEvents.calendarId))
      .where(and(lte(calendarEvents.startDate, to), gte(calendarEvents.endDate, from)))
      .orderBy(asc(calendarEvents.startDate), asc(calendarEvents.startTime));
    const out: CalendarEvent[] = rows.map(({ e, calendarName }) => ({
      id: e.id, calendarId: e.calendarId, calendarName, uid: e.uid, title: e.title, startDate: e.startDate, startTime: e.startTime,
      endDate: e.endDate, endTime: e.endTime, allDay: e.allDay, location: e.location, description: e.description,
    }));
    return c.json(out);
  });
}

