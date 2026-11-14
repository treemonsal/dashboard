// Geplanter Lauf (Cron alle 5 Minuten): Erinnerungen senden, Kalender höchstens alle 25 Minuten abgleichen.
// Wird vom scheduled-Handler in index.ts aufgerufen: ctx.waitUntil(runScheduled(env)).
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { syncCalendars } from "./calendar";
import { sendDueReminders } from "./push";
import { runHealthIfDue } from "./health/sync";
import type { Bindings } from "./util";

export const CALENDAR_EVERY_MIN = 25;

export async function runScheduled(env: Bindings, now: Date = new Date()): Promise<void> {
  try {
    await sendDueReminders(env, { now });
  } catch (e) {
    console.error("Erinnerungen fehlgeschlagen:", (e as Error)?.message ?? "unbekannt");
  }
  try {
    const db = drizzle(env.DB, { schema });
    const last = await db.select({ at: schema.syncRuns.at }).from(schema.syncRuns).where(eq(schema.syncRuns.kind, "kalender")).orderBy(desc(schema.syncRuns.at)).limit(1).get();
    if (!last || now.getTime() - Date.parse(last.at) >= CALENDAR_EVERY_MIN * 60_000) await syncCalendars(env, { now });
  } catch (e) {
    console.error("Kalender-Abgleich fehlgeschlagen:", (e as Error)?.message ?? "unbekannt");
  }
  try {
    await runHealthIfDue(env, now);
  } catch (e) {
    console.error("Gesundheits-Abgleich fehlgeschlagen:", (e as Error)?.name ?? "unbekannt");
  }
}
