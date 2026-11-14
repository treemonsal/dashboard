// Stundenplan lesen und vollständig ersetzen. Gemeinsam für /api/timetable und den Connector.
import { asc } from "drizzle-orm";
import type { Hono } from "hono";
import * as t from "./db/schema";
import { timetableReplace, type TimetableLesson } from "../shared/schemas";
import { batch, newId, v, type AppEnv, type Db } from "./util";

export async function getTimetable(db: Db): Promise<TimetableLesson[]> {
  const rows = await db.select().from(t.timetable).orderBy(asc(t.timetable.weekday), asc(t.timetable.startTime), asc(t.timetable.subject));
  return rows.map((r) => ({ id: r.id, weekday: r.weekday, startTime: r.startTime, endTime: r.endTime, subject: r.subject, room: r.room, teacher: r.teacher, validFrom: r.validFrom }));
}

/** Ersetzt alles in einem Schritt (Batch ist atomar): bei einem Fehler bleibt der alte Stundenplan. */
export async function replaceTimetable(db: Db, lessons: ReturnType<typeof timetableReplace.parse>["lessons"]): Promise<TimetableLesson[]> {
  const stmts: unknown[] = [db.delete(t.timetable)];
  for (const l of lessons) {
    stmts.push(db.insert(t.timetable).values({ id: newId(), weekday: l.weekday, startTime: l.startTime, endTime: l.endTime, subject: l.subject, room: l.room, teacher: l.teacher, validFrom: l.validFrom }));
  }
  await batch(db, stmts);
  return getTimetable(db);
}

export function registerTimetable(api: Hono<AppEnv>) {
  api.get("/timetable", async (c) => c.json({ lessons: await getTimetable(c.var.db) }));
  api.put("/timetable", v("json", timetableReplace), async (c) => c.json({ lessons: await replaceTimetable(c.var.db, c.req.valid("json").lessons) }));
}
