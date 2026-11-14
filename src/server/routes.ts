// Routen der zweiten Ebene: Einstellungen, Lernplan, Gym, Geld, Körper, Export.
import type { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "./db/schema";
import { updateDepot } from "./depot/run";
import {
  SETTING_DEFAULTS,
  accountCreate,
  categoryCreate,
  gymDaysQuery,
  investmentEntryCreate,
  gymPlanWrite,
  gymSessionCreate,
  gymSessionUpdate,
  gymSetUpdate,
  healthQuery,
  importRequest,
  healthUpsert,
  isoDate,
  settingsUpdate,
  studyPlanRequest,
  transactionBulk,
  transactionCreate,
  transactionQuery,
  transactionUpdate,
  type GymDay,
  type GymPlan,
  type GymSession,
  type GymSet,
} from "../shared/schemas";
import { planStudyBlocks } from "../shared/lernplan";
import { todayInZone, weekdayNum } from "../shared/dates";
import { commitImport, learnFromCorrection, previewImport, recompute, unconfirmedPdf } from "./bankimport";
import { registerCalendar } from "./calendar";
import { registerPush } from "./push";
import { registerTimetable } from "./timetable";
import { registerHealth } from "./health/routes";
import { batch, idParam, newId, nowIso, notFound, v, type AppEnv, type Db } from "./util";

const t = schema;

const toList = (s: string): number[] => (s ? s.split(",").map(Number) : []);
const dayParam = z.object({ day: isoDate });

async function loadPlans(db: Db, planId?: string): Promise<GymPlan[]> {
  const plans = await db.select().from(t.gymPlans).where(planId ? eq(t.gymPlans.id, planId) : undefined).orderBy(asc(t.gymPlans.sortOrder), asc(t.gymPlans.createdAt));
  if (!plans.length) return [];
  const ex = await db.select().from(t.gymExercises).where(inArray(t.gymExercises.planId, plans.map((p) => p.id))).orderBy(asc(t.gymExercises.sortOrder), asc(t.gymExercises.createdAt));
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    weekdays: toList(p.weekdays),
    sortOrder: p.sortOrder,
    exercises: ex.filter((e) => e.planId === p.id).map((e) => ({ id: e.id, planId: e.planId, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, sortOrder: e.sortOrder })),
  }));
}

async function loadSession(db: Db, day: string): Promise<GymSession | null> {
  const s = await db.select().from(t.gymSessions).where(eq(t.gymSessions.day, day)).get();
  if (!s) return null;
  const sets = await db.select().from(t.gymSets).where(eq(t.gymSets.sessionId, s.id)).orderBy(asc(t.gymSets.exerciseOrder), asc(t.gymSets.setIndex));
  return {
    id: s.id,
    day: s.day,
    planId: s.planId,
    planName: s.planName,
    finishedAt: s.finishedAt,
    sets: sets.map((x): GymSet => ({ id: x.id, sessionId: x.sessionId, exerciseName: x.exerciseName, exerciseOrder: x.exerciseOrder, setIndex: x.setIndex, reps: x.reps, weight: x.weight, done: x.done })),
  };
}

function planFor(plans: GymPlan[], day: string): GymPlan | null {
  const wd = weekdayNum(day);
  return plans.find((p) => p.weekdays.includes(wd)) ?? null;
}

function writePlan(planId: string, b: z.infer<typeof gymPlanWrite>, sortOrder?: number) {
  const exercises = b.exercises.map((e, i) => ({ id: e.id ?? newId(), planId, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight ?? null, sortOrder: i }));
  return { exercises, weekdays: [...new Set(b.weekdays)].sort((a, c) => a - c).join(","), sortOrder };
}

const toTx = (r: typeof t.transactions.$inferSelect) => ({
  id: r.id, accountId: r.accountId, categoryId: r.categoryId, date: r.date, amount: r.amount, description: r.description,
  mealOut: r.mealOut, isRepayment: r.isRepayment, repaymentOverride: r.repaymentOverride, settledAt: r.settledAt, internal: r.internal, currency: r.currency,
});

/** Kategorie "Essen auswärts" setzt "Mahlzeit auswärts" standardmässig, alles andere (auch Snack) nicht. */
async function mealDefault(db: Db, categoryId: string | null | undefined, explicit: boolean | undefined): Promise<boolean> {
  if (explicit !== undefined) return explicit;
  if (!categoryId) return false;
  const c = await db.select({ name: t.categories.name }).from(t.categories).where(eq(t.categories.id, categoryId)).get();
  return c?.name === "Essen auswärts";
}

export function registerExtra(api: Hono<AppEnv>) {
  registerCalendar(api);
  registerPush(api);
  registerTimetable(api);
  registerHealth(api);

  /* ---------- Einstellungen ---------- */
  api.get("/settings", async (c) => {
    const rows = await c.var.db.select().from(t.settings);
    return c.json({ ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  });
  api.put("/settings", v("json", settingsUpdate), async (c) => {
    const entries = Object.entries(c.req.valid("json")) as [string, string][];
    if (entries.length) {
      const stmts = entries.map(([key, value]) =>
        c.var.db.insert(t.settings).values({ key, value }).onConflictDoUpdate({ target: t.settings.key, set: { value, updatedAt: nowIso() } }),
      );
      await batch(c.var.db, stmts);
    }
    const rows = await c.var.db.select().from(t.settings);
    return c.json({ ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  });

  /* ---------- Export aller Daten ---------- */
  api.get("/export", async (c) => {
    const db = c.var.db;
    const data = {
      schemaVersion: 2,
      exportedAt: nowIso(),
      settings: await db.select().from(t.settings),
      projects: await db.select().from(t.projects),
      tasks: await db.select().from(t.tasks),
      taskEvents: await db.select().from(t.taskEvents),
      subjects: await db.select().from(t.subjects),
      timetable: await db.select().from(t.timetable),
      exams: await db.select().from(t.exams),
      examTopics: await db.select().from(t.examTopics),
      grades: await db.select().from(t.grades),
      habits: await db.select().from(t.habits),
      habitLogs: await db.select().from(t.habitLogs),
      goals: await db.select().from(t.goals),
      gymPlans: await db.select().from(t.gymPlans),
      gymExercises: await db.select().from(t.gymExercises),
      gymSessions: await db.select().from(t.gymSessions),
      gymSets: await db.select().from(t.gymSets),
      accounts: await db.select().from(t.accounts),
      categories: await db.select().from(t.categories),
      transactions: await db.select().from(t.transactions),
      categoryRules: await db.select().from(t.categoryRules),
      investmentEntries: await db.select().from(t.investmentEntries),
      healthDaily: await db.select().from(t.healthDaily),
      healthWorkouts: await db.select().from(t.healthWorkouts),
      // Kalenderadressen enthalten Zugangsschlüssel. Nur öffentliche Metadaten exportieren.
      calendars: await db.select({ id: t.calendars.id, name: t.calendars.name, sortOrder: t.calendars.sortOrder, createdAt: t.calendars.createdAt, updatedAt: t.calendars.updatedAt }).from(t.calendars),
      calendarEvents: await db.select().from(t.calendarEvents),
      syncRuns: await db.select().from(t.syncRuns),
    };
    return c.json(data);
  });

  /* ---------- Aufgaben-Ereignisse (Grundlage fürs spätere Lernen) ---------- */
  api.get("/task-events", async (c) => c.json(await c.var.db.select().from(t.taskEvents).orderBy(desc(t.taskEvents.createdAt)).limit(500)));

  /* ---------- Lernblöcke einer Prüfung ---------- */
  api.post("/exams/:id/study-plan", v("param", idParam), v("json", studyPlanRequest), async (c) => {
    const db = c.var.db;
    const examId = c.req.valid("param").id;
    const { replace, blockMin } = c.req.valid("json");
    const exam = await db.select({ e: t.exams, code: t.subjects.code }).from(t.exams).innerJoin(t.subjects, eq(t.subjects.id, t.exams.subjectId)).where(eq(t.exams.id, examId)).get();
    if (!exam) return notFound(c);
    const topics = await db.select().from(t.examTopics).where(eq(t.examTopics.examId, examId)).orderBy(asc(t.examTopics.sortOrder));
    const others = await db.select({ date: t.exams.date }).from(t.exams).where(ne(t.exams.id, examId));
    const blocks = planStudyBlocks({
      subject: exam.code,
      examDate: exam.e.date,
      today: todayInZone(),
      topics: topics.map((x) => ({ title: x.title, assessment: x.assessment })),
      busyDays: others.map((o) => o.date),
      blockMin,
    });
    if (replace) await db.delete(t.tasks).where(and(eq(t.tasks.examId, examId), isNull(t.tasks.doneAt)));
    if (!blocks.length) return c.json([]);
    const rows = blocks.map((b, i) => ({ id: newId(), title: b.title, dueDate: b.date, durationMin: b.durationMin, examId, sortOrder: i, priority: 3 }));
    await batch(db, rows.map((r) => db.insert(t.tasks).values(r)));
    return c.json(await db.select().from(t.tasks).where(inArray(t.tasks.id, rows.map((r) => r.id))).orderBy(asc(t.tasks.dueDate)), 201);
  });

  /* ---------- Gym: Pläne ---------- */
  api.get("/gym/plans", async (c) => c.json(await loadPlans(c.var.db)));
  api.post("/gym/plans", v("json", gymPlanWrite), async (c) => {
    const db = c.var.db;
    const b = c.req.valid("json");
    const planId = b.id ?? newId();
    const w = writePlan(planId, b);
    const max = await db.select({ m: sql<number>`coalesce(max(${t.gymPlans.sortOrder}), -1)` }).from(t.gymPlans).get();
    const stmts = [
      db.insert(t.gymPlans).values({ id: planId, name: b.name, weekdays: w.weekdays, sortOrder: (max?.m ?? -1) + 1 }),
      ...w.exercises.map((e) => db.insert(t.gymExercises).values(e)),
    ];
    await batch(db, stmts);
    return c.json((await loadPlans(db, planId))[0], 201);
  });
  api.put("/gym/plans/:id", v("param", idParam), v("json", gymPlanWrite), async (c) => {
    const db = c.var.db;
    const planId = c.req.valid("param").id;
    const b = c.req.valid("json");
    const exists = await db.select({ id: t.gymPlans.id }).from(t.gymPlans).where(eq(t.gymPlans.id, planId)).get();
    if (!exists) return notFound(c);
    const w = writePlan(planId, b);
    const keep = w.exercises.map((e) => e.id);
    const old = await db.select({ id: t.gymExercises.id }).from(t.gymExercises).where(eq(t.gymExercises.planId, planId));
    const drop = old.map((o) => o.id).filter((x) => !keep.includes(x));
    const stmts = [
      db.update(t.gymPlans).set({ name: b.name, weekdays: w.weekdays, updatedAt: nowIso() }).where(eq(t.gymPlans.id, planId)),
      ...(drop.length ? [db.delete(t.gymExercises).where(inArray(t.gymExercises.id, drop))] : []),
      ...w.exercises.map((e) =>
        db.insert(t.gymExercises).values(e).onConflictDoUpdate({ target: t.gymExercises.id, set: { name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, sortOrder: e.sortOrder, updatedAt: nowIso() } }),
      ),
    ];
    await batch(db, stmts);
    return c.json((await loadPlans(db, planId))[0]);
  });
  api.delete("/gym/plans/:id", v("param", idParam), async (c) => {
    const row = await c.var.db.delete(t.gymPlans).where(eq(t.gymPlans.id, c.req.valid("param").id)).returning({ id: t.gymPlans.id }).get();
    return row ? c.json({ ok: true }) : notFound(c);
  });

  /* ---------- Gym: Tage und Trainings ---------- */
  api.get("/gym/days", v("query", gymDaysQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    const rows = await c.var.db
      .select({ day: t.gymSessions.day, finishedAt: t.gymSessions.finishedAt })
      .from(t.gymSessions)
      .where(and(gte(t.gymSessions.day, from), lte(t.gymSessions.day, to)))
      .orderBy(asc(t.gymSessions.day));
    return c.json(rows.map((r) => ({ day: r.day, finished: r.finishedAt !== null })));
  });
  api.get("/gym/day/:day", v("param", dayParam), async (c) => {
    const day = c.req.valid("param").day;
    const out: GymDay = { day, plan: planFor(await loadPlans(c.var.db), day), session: await loadSession(c.var.db, day) };
    return c.json(out);
  });
  // Holt das Training eines Tages oder legt es aus dem Plan an (Gewichte vom letzten Mal).
  api.post("/gym/sessions/:day", v("param", dayParam), v("json", gymSessionCreate), async (c) => {
    const db = c.var.db;
    const day = c.req.valid("param").day;
    const existing = await loadSession(db, day);
    if (existing) return c.json(existing);
    const plans = await loadPlans(db);
    const { planId } = c.req.valid("json");
    const plan = planId ? (plans.find((p) => p.id === planId) ?? null) : planFor(plans, day);
    const sessionId = newId();
    const stmts: unknown[] = [db.insert(t.gymSessions).values({ id: sessionId, day, planId: plan?.id ?? null, planName: plan?.name ?? null })];
    for (const [ei, e] of (plan?.exercises ?? []).entries()) {
      const last = await db
        .select({ w: t.gymSets.weight })
        .from(t.gymSets)
        .innerJoin(t.gymSessions, eq(t.gymSessions.id, t.gymSets.sessionId))
        .where(and(eq(t.gymSets.exerciseName, e.name), eq(t.gymSets.done, true)))
        .orderBy(desc(t.gymSessions.day), desc(t.gymSets.setIndex))
        .limit(1)
        .get();
      for (let i = 0; i < e.sets; i++) {
        stmts.push(db.insert(t.gymSets).values({ id: newId(), sessionId, exerciseName: e.name, exerciseOrder: ei, setIndex: i, reps: e.reps, weight: last?.w ?? e.weight ?? null }));
      }
    }
    await batch(db, stmts);
    return c.json(await loadSession(db, day), 201);
  });
  api.patch("/gym/sessions/:day", v("param", dayParam), v("json", gymSessionUpdate), async (c) => {
    const day = c.req.valid("param").day;
    const cur = await c.var.db.select().from(t.gymSessions).where(eq(t.gymSessions.day, day)).get();
    if (!cur) {
      // Training ohne Plan eintragen: Sitzung anlegen und abschliessen.
      if (!c.req.valid("json").finished) return notFound(c);
      await c.var.db.insert(t.gymSessions).values({ id: newId(), day, finishedAt: nowIso() });
    } else {
      await c.var.db.update(t.gymSessions).set({ finishedAt: c.req.valid("json").finished ? (cur.finishedAt ?? nowIso()) : null, updatedAt: nowIso() }).where(eq(t.gymSessions.id, cur.id));
    }
    return c.json(await loadSession(c.var.db, day));
  });
  api.delete("/gym/sessions/:day", v("param", dayParam), async (c) => {
    const row = await c.var.db.delete(t.gymSessions).where(eq(t.gymSessions.day, c.req.valid("param").day)).returning({ id: t.gymSessions.id }).get();
    return row ? c.json({ ok: true }) : notFound(c);
  });
  api.patch("/gym/sets/:id", v("param", idParam), v("json", gymSetUpdate), async (c) => {
    const row = await c.var.db.update(t.gymSets).set({ ...c.req.valid("json"), updatedAt: nowIso() }).where(eq(t.gymSets.id, c.req.valid("param").id)).returning().get();
    return row ? c.json(row) : notFound(c);
  });
  // Verlauf des schwersten erledigten Satzes pro Übung und Tag (letzte 12 Trainings je Übung).
  api.get("/gym/history", async (c) => {
    const rows = await c.var.db
      .select({ name: t.gymSets.exerciseName, day: t.gymSessions.day, w: sql<number>`max(${t.gymSets.weight})`.mapWith(Number) })
      .from(t.gymSets)
      .innerJoin(t.gymSessions, eq(t.gymSessions.id, t.gymSets.sessionId))
      .where(and(eq(t.gymSets.done, true), sql`${t.gymSets.weight} is not null`))
      .groupBy(t.gymSets.exerciseName, t.gymSessions.day)
      .orderBy(asc(t.gymSessions.day));
    const out: Record<string, { day: string; weight: number }[]> = {};
    for (const r of rows) (out[r.name] ??= []).push({ day: r.day, weight: r.w });
    for (const k of Object.keys(out)) out[k] = out[k].slice(-12);
    return c.json(out);
  });

  /* ---------- Geld ---------- */
  api.get("/accounts", async (c) => {
    const rows = await c.var.db
      .select({
        id: t.accounts.id,
        name: t.accounts.name,
        bank: t.accounts.bank,
        currency: t.accounts.currency,
        openingBalance: t.accounts.openingBalance,
        sortOrder: t.accounts.sortOrder,
        balance: sql<number>`${t.accounts.openingBalance} + coalesce((select sum(amount) from transactions x where x.account_id = accounts.id), 0)`.mapWith(Number),
      })
      .from(t.accounts)
      .orderBy(asc(t.accounts.sortOrder), asc(t.accounts.name));
    return c.json(rows);
  });
  api.post("/accounts", v("json", accountCreate), async (c) => {
    const b = c.req.valid("json");
    const row = await c.var.db.insert(t.accounts).values({ ...b, id: b.id ?? newId() }).returning().get();
    return c.json({ ...row, balance: row.openingBalance }, 201);
  });
  api.get("/categories", async (c) => c.json(await c.var.db.select().from(t.categories).orderBy(asc(t.categories.sortOrder), asc(t.categories.name))));
  api.post("/categories", v("json", categoryCreate), async (c) => {
    const b = c.req.valid("json");
    return c.json(await c.var.db.insert(t.categories).values({ ...b, id: b.id ?? newId() }).returning().get(), 201);
  });
  api.get("/transactions", v("query", transactionQuery), async (c) => {
    const { month, limit } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(t.transactions)
      .where(month ? like(t.transactions.date, `${month}-%`) : undefined)
      .orderBy(desc(t.transactions.date), desc(t.transactions.createdAt))
      .limit(limit);
    return c.json(rows.map(toTx));
  });
  api.post("/transactions", v("json", transactionCreate), async (c) => {
    const b = c.req.valid("json");
    const mealOut = await mealDefault(c.var.db, b.categoryId, b.mealOut);
    const row = await c.var.db.insert(t.transactions).values({ ...b, mealOut, repaymentOverride: b.isRepayment ?? null, id: b.id ?? newId() }).returning().get();
    return c.json(toTx(row), 201);
  });
  api.post("/transactions/bulk", v("json", transactionBulk), async (c) => {
    const db = c.var.db;
    const rows = [];
    for (const x of c.req.valid("json").transactions) rows.push({ ...x, repaymentOverride: x.isRepayment ?? null, id: x.id ?? newId(), mealOut: await mealDefault(db, x.categoryId, x.mealOut) });
    // D1 erlaubt wenige Parameter pro Anweisung: in kleinen Gruppen einfügen.
    for (let i = 0; i < rows.length; i += 5) await db.insert(t.transactions).values(rows.slice(i, i + 5));
    return c.json({ inserted: rows.length }, 201);
  });
  api.patch("/transactions/:id", v("param", idParam), v("json", transactionUpdate), async (c) => {
    const { settled, ...rest } = c.req.valid("json");
    const set: Partial<typeof t.transactions.$inferInsert> = { ...rest, updatedAt: nowIso() };
    if (settled !== undefined) set.settledAt = settled ? nowIso() : null;
    const txId = c.req.valid("param").id;
    const before = await c.var.db.select({ categoryId: t.transactions.categoryId }).from(t.transactions).where(eq(t.transactions.id, txId)).get();
    // Von Hand umgeschaltet: Mahlzeit ja/nein bleibt bei späteren Importen bestehen.
    if (rest.mealOut !== undefined) set.mealOverride = rest.mealOut;
    if (rest.isRepayment !== undefined && rest.repaymentOverride === undefined) set.repaymentOverride = rest.isRepayment;
    if (set.repaymentOverride !== undefined && set.repaymentOverride !== null) set.isRepayment = set.repaymentOverride;
    const row = await c.var.db.update(t.transactions).set(set).where(eq(t.transactions.id, txId)).returning().get();
    if (!row) return notFound(c);
    // Kategorie korrigiert: Regel lernen (gilt ab dem nächsten Import und für gleichartige "Sonstiges"-Buchungen)
    if (rest.categoryId && rest.categoryId !== before?.categoryId) await learnFromCorrection(c.var.db, txId, rest.categoryId);
    else if (rest.mealOut !== undefined || rest.isRepayment !== undefined || rest.repaymentOverride !== undefined) await recompute(c.var.db);
    const fresh = await c.var.db.select().from(t.transactions).where(eq(t.transactions.id, txId)).get();
    return c.json(toTx(fresh ?? row));
  });
  api.delete("/transactions/:id", v("param", idParam), async (c) => {
    const row = await c.var.db.delete(t.transactions).where(eq(t.transactions.id, c.req.valid("param").id)).returning({ id: t.transactions.id }).get();
    return row ? c.json({ ok: true }) : notFound(c);
  });

  /* ---------- Depot (S&P 500): Werte und Einzahlungen von Hand ---------- */
  const investOut = (r: typeof t.investmentEntries.$inferSelect) => ({ id: r.id, kind: r.kind, date: r.date, amount: r.amount, note: r.note, estimated: r.estimated });
  api.get("/invest", async (c) => {
    const rows = await c.var.db.select().from(t.investmentEntries).orderBy(asc(t.investmentEntries.date), asc(t.investmentEntries.createdAt));
    return c.json(rows.map(investOut));
  });
  api.post("/invest", v("json", investmentEntryCreate), async (c) => {
    const b = c.req.valid("json");
    // Ein von Hand eingetragener Wert ersetzt die vom Lauf geschriebene Zeile desselben Tages (nur diese).
    if (b.kind === "value") {
      await c.var.db.delete(t.investmentEntries).where(and(eq(t.investmentEntries.kind, "value"), eq(t.investmentEntries.date, b.date), or(eq(t.investmentEntries.estimated, true), eq(t.investmentEntries.note, "auto"))));
    }
    const r = await c.var.db.insert(t.investmentEntries).values({ ...b, id: b.id ?? newId(), estimated: false }).returning().get();
    return c.json(investOut(r), 201);
  });
  api.post("/depot/refresh", async (c) => c.json(await updateDepot(c.env)));
  api.delete("/invest/:id", v("param", idParam), async (c) => {
    const row = await c.var.db.delete(t.investmentEntries).where(eq(t.investmentEntries.id, c.req.valid("param").id)).returning({ id: t.investmentEntries.id }).get();
    return row ? c.json({ ok: true }) : notFound(c);
  });

  /* ---------- Bank-Import ---------- */
  api.post("/import/preview", v("json", importRequest), async (c) => c.json(await previewImport(c.var.db, c.req.valid("json").files)));
  api.post("/import/commit", v("json", importRequest), async (c) => {
    const files = c.req.valid("json").files;
    if (unconfirmedPdf(files)) return c.json({ error: "Unsichere PDF-Zeilen: nur nach Bestätigung speichern" }, 400);
    return c.json(await commitImport(c.var.db, files), 201);
  });
  api.get("/category-rules", async (c) => c.json(await c.var.db.select().from(t.categoryRules).orderBy(desc(t.categoryRules.createdAt))));

  /* ---------- Körper ---------- */
  api.get("/health", v("query", healthQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(t.healthDaily)
      .where(and(from ? gte(t.healthDaily.day, from) : undefined, to ? lte(t.healthDaily.day, to) : undefined))
      .orderBy(asc(t.healthDaily.day));
    return c.json(rows.map(({ day, sleepMin, steps, restingHr, weightKg, source }) => ({ day, sleepMin, steps, restingHr, weightKg, source })));
  });
  api.put("/health/:day", v("param", dayParam), v("json", healthUpsert), async (c) => {
    const day = c.req.valid("param").day;
    const b = c.req.valid("json");
    const row = await c.var.db
      .insert(t.healthDaily)
      .values({ day, ...b })
      .onConflictDoUpdate({ target: t.healthDaily.day, set: { ...b, updatedAt: nowIso() } })
      .returning()
      .get();
    const { sleepMin, steps, restingHr, weightKg, source } = row;
    return c.json({ day, sleepMin, steps, restingHr, weightKg, source });
  });
}
