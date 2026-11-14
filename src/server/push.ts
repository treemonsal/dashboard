// Erinnerungen per Web Push: Abos verwalten, Test senden und fällige Erinnerungen versenden.
import type { Hono } from "hono";
import { and, asc, eq, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { pushSubscribe, pushUnsubscribe, type PushResult } from "../shared/schemas";
import { VAPID_PUBLIC_KEY } from "../shared/push-public";
import { SETTING_DEFAULTS } from "../shared/settings";
import { addDays, todayInZone } from "../shared/dates";
import { dueReminders, type Reminder } from "../shared/reminders";
import { newId, type AppEnv, type Bindings, type Db } from "./util";
import { sendWebPush, type PushMessage, type VapidConfig } from "./webpush";

const { pushSubscriptions, sentReminders, tasks, gymPlans, gymSessions, exams, subjects, settings } = schema;

export const DEFAULT_SUBJECT = "https://dashboard.workers.dev";

export interface PushDeps {
  fetcher?: typeof fetch;
  now?: Date;
  /** Nur Tests: anderer Schlüssel als der aus der Umgebung. */
  vapid?: VapidConfig;
}

export function vapidFrom(env: Bindings, deps: PushDeps = {}): VapidConfig | null {
  if (deps.vapid) return deps.vapid;
  if (!env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || DEFAULT_SUBJECT };
}

/** Sendet an alle Abos, löscht abgelaufene (404/410). */
export async function pushToAll(db: Db, cfg: VapidConfig, msg: PushMessage, deps: PushDeps = {}): Promise<PushResult> {
  const subs = await db.select().from(pushSubscriptions).orderBy(asc(pushSubscriptions.createdAt));
  const out: PushResult = { sent: 0, removed: 0, failed: 0 };
  for (const s of subs) {
    const status = await sendWebPush(s, msg, cfg, { fetcher: deps.fetcher, nowSec: deps.now ? Math.floor(deps.now.getTime() / 1000) : undefined });
    if (status >= 200 && status < 300) out.sent++;
    else if (status === 404 || status === 410) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      out.removed++;
    } else out.failed++;
  }
  return out;
}

const toList = (s: string): number[] => (s ? s.split(",").map(Number) : []);

/** Versendet alle jetzt fälligen Erinnerungen, jede höchstens einmal. Für den Cron-Handler (alle 5 Minuten). */
export async function sendDueReminders(env: Bindings, deps: PushDeps = {}): Promise<{ due: number; sent: number; removed: number }> {
  const none = { due: 0, sent: 0, removed: 0 };
  const cfg = vapidFrom(env, deps);
  if (!cfg) return none;
  const db: Db = drizzle(env.DB, { schema });
  const subs = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).limit(1);
  if (!subs.length) return none;

  const now = deps.now ?? new Date();
  const today = todayInZone(now);
  const [openTasks, plans, finished, morgen, sleep] = await Promise.all([
    db.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, dueTime: tasks.dueTime, doneAt: tasks.doneAt, parentId: tasks.parentId }).from(tasks).where(and(isNull(tasks.doneAt), isNotNull(tasks.dueDate), lte(tasks.dueDate, today))),
    db.select().from(gymPlans),
    db.select({ id: gymSessions.id }).from(gymSessions).where(and(eq(gymSessions.day, today), isNotNull(gymSessions.finishedAt))).limit(1),
    db.select({ id: exams.id, date: exams.date, startTime: exams.startTime, subjectCode: subjects.code }).from(exams).innerJoin(subjects, eq(subjects.id, exams.subjectId)).where(eq(exams.date, addDays(today, 1))),
    db.select().from(settings).where(eq(settings.key, "sleepTime")).get(),
  ]);

  const reminders = dueReminders({
    now,
    sleepTime: sleep?.value ?? SETTING_DEFAULTS.sleepTime,
    tasks: openTasks,
    plans: plans.map((p) => ({ name: p.name, weekdays: toList(p.weekdays) })),
    trainingDoneToday: finished.length > 0,
    exams: morgen,
  });

  const res = { due: reminders.length, sent: 0, removed: 0 };
  for (const r of reminders) {
    if (!(await claim(db, r))) continue;
    const out = await pushToAll(db, cfg, { title: r.title, body: r.body, url: r.url, tag: r.tag }, deps);
    res.sent += out.sent;
    res.removed += out.removed;
  }
  // Alte Schlüssel aufräumen: nach drei Tagen kann keine Erinnerung mehr fällig sein.
  await db.delete(sentReminders).where(lt(sentReminders.sentAt, new Date(now.getTime() - 3 * 86_400_000).toISOString()));
  return res;
}

/** Merkt sich die Erinnerung. false, wenn sie schon gesendet wurde (oder ein paralleler Lauf sie hat). */
async function claim(db: Db, r: Reminder): Promise<boolean> {
  const row = await db.insert(sentReminders).values({ key: r.key }).onConflictDoNothing().returning({ key: sentReminders.key }).get();
  return !!row;
}

export function registerPush(api: Hono<AppEnv>) {
  api.get("/push/status", async (c) => {
    const rows = await c.var.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions);
    return c.json({ count: rows.length, configured: !!c.env.VAPID_PRIVATE_KEY });
  });
  api.post("/push/subscribe", async (c) => {
    const parsed = pushSubscribe.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Ungültiges Abo" }, 400);
    const { endpoint, keys } = parsed.data;
    await c.var.db
      .insert(pushSubscriptions)
      .values({ id: newId(), endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: (c.req.header("user-agent") ?? "").slice(0, 200) || null })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth } });
    return c.json({ ok: true }, 201);
  });
  api.post("/push/unsubscribe", async (c) => {
    const parsed = pushUnsubscribe.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Ungültige Eingabe" }, 400);
    await c.var.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
    return c.json({ ok: true });
  });
  api.post("/push/test", async (c) => {
    const cfg = vapidFrom(c.env);
    if (!cfg) return c.json({ error: "VAPID-Schlüssel fehlt" }, 503);
    const r = await pushToAll(c.var.db, cfg, { title: "Test", body: "Erinnerungen funktionieren.", url: "/", tag: "test" });
    return c.json(r);
  });
}
