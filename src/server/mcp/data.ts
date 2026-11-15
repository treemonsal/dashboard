// Datenzugriff für die MCP-Werkzeuge: direkt über Drizzle auf die Tabellen, Rechnungen aus src/shared.
// Alle Rückgaben sind reine Daten (JSON). Texte aus der Datenbank werden nicht interpretiert.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import * as t from "../db/schema";
import { SETTING_DEFAULTS, type Settings } from "../../shared/settings";
import { MIN_SUBJECT, TARGET_AVERAGE, neededGrade, overallAverage, subjectMarks, weightedAverage, type Needed } from "../../shared/calc";
import { budgetOf, byCategory, mamaBalance, monthSummary, ownShare } from "../../shared/geld";
import { accountSaldo } from "../laufend";
import { depotRules, depotState, toDepotEntry } from "../../shared/depot";
import { addDays, daysUntil, mondayOf, timeInZone, todayInZone, weekdayLong, weekdayNum, zoneMidnightUtc } from "../../shared/dates";
import { newId, nowIso, type Db } from "../util";
import { visibleEvents } from "../../shared/agenda";
import { nextDue } from "../../shared/recurrence";
import { timetableReplace, type CalendarEvent } from "../../shared/schemas";
import { getTimetable, replaceTimetable } from "../timetable";
import { pushToAll, vapidFrom, type PushDeps } from "../push";
import type { Bindings } from "../util";

/** Fehler, die als Werkzeug-Fehler (isError) an das Modell gehen, nicht als Serverfehler. */
export class ToolInputError extends Error {}

const r2 = (x: number) => Math.round(x * 100) / 100;

export async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(t.settings);
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) } as Settings;
}

/* ---------- Aufgaben ---------- */

export type TaskView = "today" | "open" | "done" | "all";

function taskOut(r: typeof t.tasks.$inferSelect, projectNames: Map<string, string>) {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueDate: r.dueDate,
    dueTime: r.dueTime,
    durationMin: r.durationMin,
    priority: r.priority,
    project: r.projectId ? (projectNames.get(r.projectId) ?? null) : null,
    projectId: r.projectId,
    parentId: r.parentId,
    recurrence: r.recurrence,
    done: r.doneAt !== null,
    doneAt: r.doneAt,
  };
}

async function projectNameMap(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ id: t.projects.id, name: t.projects.name }).from(t.projects);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function listTasks(db: Db, q: { view: TaskView; project?: string; limit: number; today?: string }) {
  const today = q.today ?? todayInZone();
  const where: (SQL | undefined)[] = [];
  if (q.view === "today") where.push(lte(t.tasks.dueDate, today), isNull(t.tasks.doneAt));
  if (q.view === "open") where.push(isNull(t.tasks.doneAt));
  if (q.view === "done") where.push(isNotNull(t.tasks.doneAt));
  if (q.project) where.push(eq(t.tasks.projectId, (await resolveProject(db, q.project)).id));
  const rows = await db
    .select()
    .from(t.tasks)
    .where(and(...where))
    .orderBy(
      ...(q.view === "done"
        ? [desc(t.tasks.doneAt)]
        : [sql`${t.tasks.dueDate} is null`, asc(t.tasks.dueDate), sql`${t.tasks.dueTime} is null`, asc(t.tasks.dueTime), asc(t.tasks.priority), asc(t.tasks.sortOrder), asc(t.tasks.createdAt)]),
    )
    .limit(q.limit);
  const names = await projectNameMap(db);
  return { today, view: q.view, count: rows.length, tasks: rows.map((r) => taskOut(r, names)) };
}

/** Projekt nach ID oder Name (ohne Gross/Klein). Unbekannt: Fehler mit den vorhandenen Namen. */
export async function resolveProject(db: Db, ref: string): Promise<{ id: string; name: string }> {
  const rows = await db.select({ id: t.projects.id, name: t.projects.name, archived: t.projects.archived }).from(t.projects);
  const key = ref.trim().toLowerCase();
  const hit = rows.find((p) => p.id === ref) ?? rows.find((p) => !p.archived && p.name.toLowerCase() === key);
  if (!hit) {
    const names = rows.filter((p) => !p.archived).map((p) => p.name);
    throw new ToolInputError(`Projekt "${ref}" gibt es nicht. Vorhanden: ${names.length ? names.join(", ") : "keine"}.`);
  }
  return { id: hit.id, name: hit.name };
}

async function taskById(db: Db, id: string) {
  const row = await db.select().from(t.tasks).where(eq(t.tasks.id, id)).get();
  if (!row) throw new ToolInputError(`Aufgabe ${id} gibt es nicht.`);
  return row;
}

export async function addTask(
  db: Db,
  b: { title: string; dueDate?: string | null; dueTime?: string | null; durationMin?: number | null; project?: string | null; notes?: string | null; priority?: number },
) {
  const projectId = b.project ? (await resolveProject(db, b.project)).id : null;
  const row = await db
    .insert(t.tasks)
    .values({ id: newId(), title: b.title, notes: b.notes ?? null, dueDate: b.dueDate ?? null, dueTime: b.dueTime ?? null, durationMin: b.durationMin ?? null, projectId, priority: b.priority ?? 4 })
    .returning()
    .get();
  return { created: taskOut(row, await projectNameMap(db)) };
}

export async function updateTask(
  db: Db,
  id: string,
  b: { title?: string; dueDate?: string | null; dueTime?: string | null; durationMin?: number | null; project?: string | null; notes?: string | null; priority?: number },
) {
  await taskById(db, id);
  const { project, ...rest } = b;
  const set: Partial<typeof t.tasks.$inferInsert> = { ...rest, updatedAt: nowIso() };
  if (project !== undefined) set.projectId = project === null ? null : (await resolveProject(db, project)).id;
  const row = await db.update(t.tasks).set(set).where(eq(t.tasks.id, id)).returning().get();
  return { updated: taskOut(row!, await projectNameMap(db)) };
}

/** Wie PATCH /api/tasks/:id mit done=true: Zeitpunkt setzen und das Erledigen fürs Lernen festhalten. */
export async function completeTask(db: Db, id: string, actualMin?: number, now: Date = new Date()) {
  const cur = await taskById(db, id);
  const names = await projectNameMap(db);
  if (cur.doneAt) return { alreadyDone: true, task: taskOut(cur, names) };
  const doneAt = now.toISOString();
  const row = await db.update(t.tasks).set({ doneAt, updatedAt: doneAt }).where(eq(t.tasks.id, id)).returning().get();
  const day = todayInZone(now);
  await db.insert(t.taskEvents).values({
    id: newId(),
    taskId: id,
    title: cur.title,
    day,
    weekday: weekdayNum(day),
    plannedTime: cur.dueTime,
    doneTime: timeInZone(now),
    durationMin: actualMin ?? cur.durationMin,
    plannedMin: cur.durationMin,
  });
  // Wiederkehrende Aufgabe: wie in der App entsteht die nächste sofort, mit denselben Angaben.
  const next = cur.recurrence ? nextDue(cur.recurrence, cur.dueDate, day) : null;
  let nextTask = null;
  if (next) {
    const n = await db
      .insert(t.tasks)
      .values({
        id: newId(), title: cur.title, notes: cur.notes, projectId: cur.projectId, parentId: cur.parentId, dueDate: next, dueTime: cur.dueTime,
        priority: cur.priority, recurrence: cur.recurrence, durationMin: cur.durationMin, examId: cur.examId, sortOrder: cur.sortOrder,
      })
      .returning()
      .get();
    nextTask = taskOut(n, names);
  }
  return { alreadyDone: false, task: taskOut(row!, names), next: nextTask };
}

/* ---------- Schule ---------- */

const ASSESS = ["open", "unsure", "solid"] as const;
export type AssessmentName = (typeof ASSESS)[number];

export async function resolveSubject(db: Db, code: string): Promise<{ id: string; code: string }> {
  const rows = await db.select({ id: t.subjects.id, code: t.subjects.code }).from(t.subjects).orderBy(asc(t.subjects.sortOrder), asc(t.subjects.code));
  const key = code.trim().toLowerCase();
  const hit = rows.find((s) => s.code.toLowerCase() === key) ?? rows.find((s) => s.id === code);
  if (!hit) throw new ToolInputError(`Fach "${code}" gibt es nicht. Vorhanden: ${rows.map((s) => s.code).join(", ") || "keine"}.`);
  return hit;
}

async function examsWithTopics(db: Db, where: SQL | undefined) {
  const rows = await db
    .select({ e: t.exams, subjectCode: t.subjects.code })
    .from(t.exams)
    .innerJoin(t.subjects, eq(t.subjects.id, t.exams.subjectId))
    .where(where)
    .orderBy(asc(t.exams.date), sql`${t.exams.startTime} is null`, asc(t.exams.startTime));
  const ids = rows.map((r) => r.e.id);
  const topics = ids.length
    ? await db.select().from(t.examTopics).where(inArray(t.examTopics.examId, ids)).orderBy(asc(t.examTopics.sortOrder), asc(t.examTopics.createdAt))
    : [];
  return rows.map(({ e, subjectCode }) => ({
    id: e.id,
    subject: subjectCode,
    title: e.title,
    date: e.date,
    weekday: weekdayLong(e.date),
    daysUntil: daysUntil(e.date),
    startTime: e.startTime,
    endTime: e.endTime,
    room: e.room,
    status: e.status,
    topics: topics.filter((x) => x.examId === e.id).map((x) => ({ id: x.id, title: x.title, assessment: ASSESS[x.assessment] ?? "open", summary: x.summary ?? null })),
  }));
}

export async function listExams(db: Db, q: { from?: string; to?: string }) {
  const from = q.from ?? todayInZone();
  const exams = await examsWithTopics(db, and(gte(t.exams.date, from), q.to ? lte(t.exams.date, q.to) : undefined));
  return { from, to: q.to ?? null, count: exams.length, exams };
}

export async function addExam(
  db: Db,
  b: { subject: string; title: string; date: string; startTime?: string | null; endTime?: string | null; room?: string | null; topics?: string[] },
) {
  const subject = await resolveSubject(db, b.subject);
  const examId = newId();
  const stmts = [
    db.insert(t.exams).values({ id: examId, subjectId: subject.id, title: b.title, date: b.date, startTime: b.startTime ?? null, endTime: b.endTime ?? null, room: b.room ?? null, source: "connector" }),
    ...(b.topics ?? []).map((title, i) => db.insert(t.examTopics).values({ id: newId(), examId, title, sortOrder: i })),
  ];
  await db.batch(stmts as [(typeof stmts)[0], ...typeof stmts]);
  return { created: (await examsWithTopics(db, eq(t.exams.id, examId)))[0] };
}

/** Themen ergänzen und Einschätzung setzen. Entfernt nie ein Thema. */
export async function setExamTopics(db: Db, examId: string, topics: { title: string; assessment?: AssessmentName }[]) {
  const exists = await db.select({ id: t.exams.id }).from(t.exams).where(eq(t.exams.id, examId)).get();
  if (!exists) throw new ToolInputError(`Prüfung ${examId} gibt es nicht.`);
  const cur = await db.select().from(t.examTopics).where(eq(t.examTopics.examId, examId));
  let next = cur.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
  const stmts: unknown[] = [];
  let added = 0;
  let changed = 0;
  const seen = new Set<string>();
  for (const tp of topics) {
    const key = tp.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = cur.find((x) => x.title.toLowerCase() === key);
    const a = tp.assessment ? ASSESS.indexOf(tp.assessment) : undefined;
    if (hit) {
      if (a !== undefined && a !== hit.assessment) {
        stmts.push(db.update(t.examTopics).set({ assessment: a, updatedAt: nowIso() }).where(eq(t.examTopics.id, hit.id)));
        changed++;
      }
    } else {
      stmts.push(db.insert(t.examTopics).values({ id: newId(), examId, title: tp.title, assessment: a ?? 0, sortOrder: next++ }));
      added++;
    }
  }
  if (stmts.length) await db.batch(stmts as never);
  return { added, changed, exam: (await examsWithTopics(db, eq(t.exams.id, examId)))[0] };
}

/** Zusammenfassung eines Themas setzen (ersetzt die bisherige; leer löscht sie). Themen-ID aus list_exams. */
export async function setTopicSummary(db: Db, topicId: string, summary: string) {
  const row = await db.select().from(t.examTopics).where(eq(t.examTopics.id, topicId)).get();
  if (!row) throw new ToolInputError(`Thema ${topicId} gibt es nicht.`);
  const text = summary.trim();
  await db.update(t.examTopics).set({ summary: text || null, updatedAt: nowIso() }).where(eq(t.examTopics.id, topicId));
  return { topicId, title: row.title, summary: text || null, length: text.length };
}

export async function listGrades(db: Db, q: { subject?: string; limit: number }) {
  const subjectId = q.subject ? (await resolveSubject(db, q.subject)).id : undefined;
  const rows = await db
    .select({ g: t.grades, code: t.subjects.code })
    .from(t.grades)
    .innerJoin(t.subjects, eq(t.subjects.id, t.grades.subjectId))
    .where(subjectId ? eq(t.grades.subjectId, subjectId) : undefined)
    .orderBy(desc(t.grades.date), desc(t.grades.createdAt))
    .limit(q.limit);
  return { count: rows.length, grades: rows.map(({ g, code }) => ({ id: g.id, subject: code, title: g.title, value: g.value, weight: g.weight, date: g.date })) };
}

export async function addGrade(db: Db, b: { subject: string; value: number; weight?: number; date?: string; title?: string | null }) {
  const subject = await resolveSubject(db, b.subject);
  const row = await db
    .insert(t.grades)
    .values({ id: newId(), subjectId: subject.id, value: b.value, weight: b.weight ?? 1, date: b.date ?? todayInZone(), title: b.title ?? null, source: "connector" })
    .returning()
    .get();
  return { created: { id: row.id, subject: subject.code, title: row.title, value: row.value, weight: row.weight, date: row.date } };
}

function neededText(n: Needed | null): string {
  if (!n) return "–";
  if (n.kind === "reached") return "erreicht";
  if (n.kind === "impossible") return `mit einer Note nicht erreichbar (bräuchte ${n.needed})`;
  return `nächste Note mindestens ${n.value}`;
}

export async function gradeSummary(db: Db) {
  const subjects = await db.select().from(t.subjects).orderBy(asc(t.subjects.sortOrder), asc(t.subjects.code));
  const gs = await db.select({ subjectId: t.grades.subjectId, value: t.grades.value, weight: t.grades.weight }).from(t.grades);
  const all = subjects.map((s) => {
    const mine = gs.filter((g) => g.subjectId === s.id);
    const average = weightedAverage(mine);
    const marks = subjectMarks(average);
    const counts = s.counts;
    // Fächer, die nicht zählen: nur Information, kein Ziel, keine "nötige Note".
    const for45 = counts && mine.length ? neededGrade(mine, TARGET_AVERAGE) : null;
    const for4 = counts && average !== null && average < MIN_SUBJECT ? neededGrade(mine, MIN_SUBJECT) : null;
    return {
      subject: s.code,
      name: s.name,
      counts,
      grades: mine.length,
      average,
      certificateGrade: marks?.certificate ?? null,
      nextGradeFor45: for45,
      nextGradeFor4: for4,
      hinweis: average === null ? "noch keine Note" : !counts ? "zählt nicht zum Schnitt" : neededText(for45),
    };
  });
  const per = all.filter((p) => p.counts);
  const informational = all.filter((p) => !p.counts);
  const overall = overallAverage(per.map((p) => p.average));
  const counted = per.filter((p) => p.average !== null);
  const below = per.filter((p) => p.average !== null && p.average < MIN_SUBJECT);
  // Gesamtschnitt = Mittel der Fachschnitte: so viele Schnittpunkte fehlen über alle Fächer zusammen.
  const missingPoints = overall !== null && overall < TARGET_AVERAGE ? r2((TARGET_AVERAGE - overall) * counted.length) : 0;
  const lines = [
    overall === null ? "Noch keine Noten." : `Gesamtschnitt ${overall} (Ziel ${TARGET_AVERAGE}).`,
    overall !== null && overall < TARGET_AVERAGE ? `Es fehlen ${missingPoints} Schnittpunkte, verteilt auf die Fächer.` : null,
    below.length ? `Unter ${MIN_SUBJECT}: ${below.map((b) => `${b.subject} ${b.average}`).join(", ")}.` : `Kein Fach unter ${MIN_SUBJECT}.`,
    informational.length ? `Nicht gezählt: ${informational.map((p) => p.subject).join(", ")}.` : null,
  ].filter(Boolean);
  return {
    target: TARGET_AVERAGE,
    minSubject: MIN_SUBJECT,
    overallAverage: overall,
    targetReached: overall !== null && overall >= TARGET_AVERAGE && below.length === 0,
    missingAveragePoints: missingPoints,
    subjectsBelowMin: below.map((b) => ({ subject: b.subject, average: b.average, nextGradeFor4: b.nextGradeFor4 })),
    subjects: per,
    notCounted: informational.map(({ nextGradeFor45, nextGradeFor4, ...p }) => p),
    zusammenfassung: lines.join(" "),
  };
}

/* ---------- Gym ---------- */

const toList = (s: string): number[] => (s ? s.split(",").map(Number) : []);

export async function gymWeek(db: Db, date?: string) {
  const ref = date ?? todayInZone();
  const monday = mondayOf(ref);
  const sunday = addDays(monday, 6);
  const settings = await loadSettings(db);
  const goal = Number(settings.gymGoal) || 4;
  const plans = await db.select().from(t.gymPlans).orderBy(asc(t.gymPlans.sortOrder), asc(t.gymPlans.createdAt));
  const sessions = await db.select().from(t.gymSessions).where(and(gte(t.gymSessions.day, addDays(monday, -7 * 7)), lte(t.gymSessions.day, sunday)));
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    const plan = plans.find((p) => toList(p.weekdays).includes(weekdayNum(day)));
    const s = sessions.find((x) => x.day === day);
    return { day, weekday: weekdayLong(day), plannedPlan: plan?.name ?? null, trained: !!s?.finishedAt, started: !!s && !s.finishedAt, sessionPlan: s?.planName ?? null };
  });
  const trained = days.filter((d) => d.trained).length;
  const history = Array.from({ length: 8 }, (_, i) => {
    const m = addDays(monday, -7 * (7 - i));
    const e = addDays(m, 6);
    return { weekOf: m, trained: sessions.filter((x) => x.finishedAt && x.day >= m && x.day <= e).length };
  });
  return { weekOf: monday, goal, trained, left: Math.max(0, goal - trained), days, last8Weeks: history };
}

export async function logWorkout(db: Db, b: { day?: string; plan?: string | null; exercises?: { name: string; sets: { reps: number; weight?: number | null }[] }[] }) {
  const day = b.day ?? todayInZone();
  if (day > addDays(todayInZone(), 1)) throw new ToolInputError("Ein Training kann nicht in der Zukunft eingetragen werden.");
  const plans = await db.select().from(t.gymPlans);
  let plan: (typeof plans)[number] | undefined;
  if (b.plan) {
    const key = b.plan.trim().toLowerCase();
    plan = plans.find((p) => p.id === b.plan) ?? plans.find((p) => p.name.toLowerCase() === key);
    if (!plan) throw new ToolInputError(`Plan "${b.plan}" gibt es nicht. Vorhanden: ${plans.map((p) => p.name).join(", ") || "keine"}.`);
  } else {
    plan = plans.find((p) => toList(p.weekdays).includes(weekdayNum(day)));
  }
  const now = nowIso();
  let session = await db.select().from(t.gymSessions).where(eq(t.gymSessions.day, day)).get();
  const created = !session;
  if (!session) {
    session = await db.insert(t.gymSessions).values({ id: newId(), day, planId: plan?.id ?? null, planName: plan?.name ?? null, finishedAt: now }).returning().get();
  } else if (!session.finishedAt) {
    session = await db.update(t.gymSessions).set({ finishedAt: now, updatedAt: now }).where(eq(t.gymSessions.id, session.id)).returning().get();
  }
  const s = session!;
  let setsAdded = 0;
  if (b.exercises?.length) {
    const existing = await db.select({ o: t.gymSets.exerciseOrder }).from(t.gymSets).where(eq(t.gymSets.sessionId, s.id));
    let order = existing.reduce((m, x) => Math.max(m, x.o), -1) + 1;
    const stmts: unknown[] = [];
    for (const ex of b.exercises) {
      ex.sets.forEach((st, i) => stmts.push(db.insert(t.gymSets).values({ id: newId(), sessionId: s.id, exerciseName: ex.name, exerciseOrder: order, setIndex: i, reps: st.reps, weight: st.weight ?? null, done: true })));
      setsAdded += ex.sets.length;
      order++;
    }
    // D1 erlaubt wenige Parameter pro Anweisung; einzelne Inserts im Batch sind klein genug.
    if (stmts.length) await db.batch(stmts as never);
  }
  return { day, created, plan: s.planName, finished: true, setsAdded, week: await gymWeek(db, day) };
}

/* ---------- Geld (nur Zusammenfassungen) ---------- */

export async function moneySummary(db: Db, month?: string) {
  const today = todayInZone();
  const m = month ?? today.slice(0, 7);
  const settings = await loadSettings(db);
  const budget = budgetOf(settings.salary, settings.investMonthly);
  const cols = {
    id: t.transactions.id,
    date: t.transactions.date,
    amount: t.transactions.amount,
    mealOut: t.transactions.mealOut,
    isRepayment: t.transactions.isRepayment,
    settledAt: t.transactions.settledAt,
    categoryId: t.transactions.categoryId,
    internal: t.transactions.internal,
    state: t.transactions.state,
  };
  const monthTx = await db.select(cols).from(t.transactions).where(like(t.transactions.date, `${m}-%`));
  const allTx = await db.select(cols).from(t.transactions);
  const cats = new Map((await db.select({ id: t.categories.id, name: t.categories.name }).from(t.categories)).map((c) => [c.id, c.name]));
  const summary = monthSummary(monthTx, budget);
  // Vorläufige Buchungen zählen schon mit; hier nur ihr Anteil. Nicht erfasst: Differenz zum eingetippten Kontostand (im Monat der Eingabe).
  const prov = monthTx.filter((x) => x.state === "provisional");
  const provSpent = r2(prov.reduce((a, x) => a + ownShare(x), 0));
  let unrecorded = 0;
  for (const a of await db.select({ id: t.accounts.id }).from(t.accounts)) {
    const sd = await accountSaldo(db, a.id);
    if (sd && sd.result.unrecorded > 0 && sd.result.day?.startsWith(m)) unrecorded += sd.result.unrecorded;
  }
  unrecorded = r2(unrecorded);
  const mama = mamaBalance(allTx);
  const entries = await db.select().from(t.investmentEntries).orderBy(asc(t.investmentEntries.date), asc(t.investmentEntries.createdAt));
  const depot = depotState(entries.map(toDepotEntry), depotRules(settings));
  const accounts = await db
    .select({
      name: t.accounts.name,
      currency: t.accounts.currency,
      balance: sql<number>`${t.accounts.openingBalance} + coalesce((select sum(amount) from transactions x where x.account_id = accounts.id), 0)`.mapWith(Number),
    })
    .from(t.accounts)
    .orderBy(asc(t.accounts.sortOrder), asc(t.accounts.name));
  return {
    month: m,
    currency: "CHF",
    budget: summary.budget,
    spent: summary.spent,
    left: r2(summary.left - unrecorded),
    provisional: { count: prov.length, spent: provSpent, share: summary.spent > 0 ? r2(provSpent / summary.spent) : 0 },
    unrecorded,
    income: summary.income,
    hasData: summary.hasData,
    byCategory: byCategory(monthTx).slice(0, 12).map((c) => ({ category: c.categoryId ? (cats.get(c.categoryId) ?? "Unbekannt") : "Ohne Kategorie", amount: c.amount })),
    openFromMama: mama.open,
    openMeals: mama.meals.filter((x) => x.status !== "settled").length,
    depot: { value: depot.latest?.value ?? null, valueDate: depot.latest?.date ?? null, estimated: depot.latest?.estimated ?? false, deposits: depot.deposited, gain: depot.gain, gainPercent: depot.pct },
    accounts: accounts.map((a) => ({ name: a.name, currency: a.currency, balance: r2(a.balance) })),
    hinweis: "Nur Zusammenfassungen. Einzelbuchungen und Gegenparteien gibt dieser Connector nicht heraus.",
  };
}

/* ---------- Körper (nur Zusammenfassungen) ---------- */

export async function healthSummary(db: Db, days: number) {
  const today = todayInZone();
  const from = addDays(today, -(days - 1));
  const rows = await db.select().from(t.healthDaily).where(and(gte(t.healthDaily.day, from), lte(t.healthDaily.day, today))).orderBy(asc(t.healthDaily.day));
  const avg = (k: "sleepMin" | "steps" | "restingHr" | "weightKg") => {
    const v = rows.map((r) => r[k]).filter((x): x is number => x !== null);
    return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const last = (k: "sleepMin" | "steps" | "restingHr" | "weightKg") => {
    const r = [...rows].reverse().find((x) => x[k] !== null);
    return r ? { day: r.day, value: r[k] } : null;
  };
  return {
    from,
    to: today,
    daysWithData: rows.length,
    average: { sleepMin: avg("sleepMin"), steps: avg("steps"), restingHr: avg("restingHr"), weightKg: avg("weightKg") },
    latest: { sleepMin: last("sleepMin"), steps: last("steps"), restingHr: last("restingHr"), weightKg: last("weightKg") },
  };
}

/* ---------- Termine ---------- */

/**
 * Termine, die den Zeitraum berühren (auch mehrtägige, die vorher begonnen haben), wie GET /api/calendar/events.
 * Ausgeblendet wird wie in der App: Hausaufgaben (Einstellung) und Prüfungen, die schon als Prüfung eingetragen sind.
 * Die Kalender-Adresse (Zugangsschlüssel) wird nie gelesen.
 */
export async function listEvents(db: Db, q: { from?: string; to?: string }) {
  const from = q.from ?? todayInZone();
  const to = q.to ?? addDays(from, 6);
  if (to < from) throw new ToolInputError("'to' liegt vor 'from'.");
  if (to > addDays(from, 92)) throw new ToolInputError("Höchstens 93 Tage auf einmal.");
  const rows = await db
    .select({ e: t.calendarEvents, calendarName: t.calendars.name })
    .from(t.calendarEvents)
    .innerJoin(t.calendars, eq(t.calendars.id, t.calendarEvents.calendarId))
    .where(and(lte(t.calendarEvents.startDate, to), gte(t.calendarEvents.endDate, from)))
    .orderBy(asc(t.calendarEvents.startDate), sql`${t.calendarEvents.startTime} is null`, asc(t.calendarEvents.startTime))
    .limit(500);
  const all: CalendarEvent[] = rows.map(({ e, calendarName }) => ({
    id: e.id, calendarId: e.calendarId, calendarName, uid: e.uid, title: e.title, startDate: e.startDate, startTime: e.startTime,
    endDate: e.endDate, endTime: e.endTime, allDay: e.allDay, location: e.location, description: e.description,
  }));
  const settings = await loadSettings(db);
  const exams = await db
    .select({ date: t.exams.date, subjectCode: t.subjects.code, subjectName: t.subjects.name })
    .from(t.exams)
    .innerJoin(t.subjects, eq(t.subjects.id, t.exams.subjectId))
    .where(and(gte(t.exams.date, from), lte(t.exams.date, to)));
  const shown = visibleEvents(all, { hideHomework: settings.hideHomework === "1", exams });
  const events = shown.map((e) => ({
    id: e.id,
    title: e.title,
    date: e.startDate,
    weekday: weekdayLong(e.startDate),
    startTime: e.startTime,
    endDate: e.endDate,
    endTime: e.endTime,
    allDay: e.allDay,
    location: e.location,
    description: e.description ? e.description.slice(0, 500) : null,
    calendar: e.calendarName,
  }));
  const calendarsSet = (await db.select({ id: t.calendars.id }).from(t.calendars).limit(1)).length > 0;
  return {
    from,
    to,
    count: events.length,
    hidden: all.length - shown.length,
    events,
    ...(calendarsSet ? {} : { hinweis: "Es ist noch kein Kalender eingerichtet." }),
  };
}

/* ---------- Überblick ---------- */

export async function todayOverview(db: Db, scopes: readonly string[]) {
  const today = todayInZone();
  const has = (s: string) => scopes.includes(s);
  const out: Record<string, unknown> = { date: today, weekday: weekdayLong(today), time: timeInZone() };
  const tasks = await db
    .select()
    .from(t.tasks)
    .where(and(isNull(t.tasks.parentId), or(and(lte(t.tasks.dueDate, today), isNull(t.tasks.doneAt)), gte(t.tasks.doneAt, zoneMidnightUtc(today)))))
    .orderBy(asc(t.tasks.dueDate), sql`${t.tasks.dueTime} is null`, asc(t.tasks.dueTime), asc(t.tasks.priority));
  const names = await projectNameMap(db);
  const open = tasks.filter((x) => !x.doneAt);
  out.tasks = {
    open: open.length,
    overdue: open.filter((x) => x.dueDate! < today).length,
    doneToday: tasks.length - open.length,
    items: open.slice(0, 30).map((x) => taskOut(x, names)),
  };
  if (has("calendar")) out.events = (await listEvents(db, { from: today, to: today })).events;
  if (has("school")) {
    const ex = await examsWithTopics(db, and(gte(t.exams.date, today), lte(t.exams.date, addDays(today, 14))));
    out.examsNext14Days = ex.map(({ topics, ...e }) => ({ ...e, topics: topics.length, topicsSolid: topics.filter((x) => x.assessment === "solid").length }));
  }
  if (has("gym")) {
    const w = await gymWeek(db, today);
    const d = w.days.find((x) => x.day === today)!;
    out.gym = { plannedToday: d.plannedPlan, trainedToday: d.trained, weekTrained: w.trained, weekGoal: w.goal };
  }
  if (has("money:read")) {
    const m = await moneySummary(db);
    out.money = { month: m.month, left: m.left, budget: m.budget, spent: m.spent, openFromMama: m.openFromMama };
  }
  return out;
}


/* ---------- Stundenplan ---------- */

export async function getTimetableData(db: Db) {
  const lessons = await getTimetable(db);
  const settings = await loadSettings(db);
  return {
    count: lessons.length,
    schoolHolidayUntil: settings.schoolHolidayUntil || null,
    lessons: lessons.map(({ id, ...l }) => l),
    hinweis: "weekday: 1 = Montag bis 7 = Sonntag. Lektionen wiederholen sich jede Woche; Ferien kennt der Stundenplan nicht.",
  };
}

export async function setTimetableData(db: Db, input: unknown) {
  const parsed = timetableReplace.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new ToolInputError(`Ungültiger Stundenplan: ${i.path.join(".") || "Eingabe"} ${i.message}`);
  }
  if (!parsed.data.lessons.length) throw new ToolInputError("Leerer Stundenplan: nichts ersetzt. Mindestens eine Lektion angeben.");
  const before = (await getTimetable(db)).length;
  const lessons = await replaceTimetable(db, parsed.data.lessons);
  return { replaced: before, count: lessons.length, lessons: lessons.map(({ id, ...l }) => l) };
}

/* ---------- Mitteilung aufs Handy ---------- */

export const NOTIFY_PER_DAY = 10;
export const NOTIFY_URL = "/ziele";

/** Zählt über sentReminders (Schlüssel notify:<Tag>:<n>): der Einfüge-Konflikt macht das Vergeben der n-ten Nachricht atomar. */
async function claimNotifySlot(db: Db, day: string): Promise<boolean> {
  for (let n = 1; n <= NOTIFY_PER_DAY; n++) {
    const row = await db.insert(t.sentReminders).values({ key: `notify:${day}:${n}` }).onConflictDoNothing().returning({ key: t.sentReminders.key }).get();
    if (row) return true;
  }
  return false;
}

export async function notifyOwner(db: Db, env: Bindings, b: { title: string; body: string }, deps: PushDeps = {}) {
  const cfg = vapidFrom(env, deps);
  if (!cfg) throw new ToolInputError("Mitteilungen sind auf dem Server nicht eingerichtet (VAPID-Schlüssel fehlt).");
  const devices = await db.select({ id: t.pushSubscriptions.id }).from(t.pushSubscriptions).limit(1);
  if (!devices.length) throw new ToolInputError("Kein Gerät angemeldet. Tim muss in der App unter Einstellungen Erinnerungen einschalten.");
  const day = todayInZone(deps.now);
  if (!(await claimNotifySlot(db, day))) throw new ToolInputError(`Tageslimit erreicht (${NOTIFY_PER_DAY} Mitteilungen pro Tag).`);
  const r = await pushToAll(db, cfg, { title: b.title, body: b.body, url: NOTIFY_URL, tag: "connector" }, deps);
  return { sent: r.sent, removedDevices: r.removed, failed: r.failed, limitPerDay: NOTIFY_PER_DAY, opens: NOTIFY_URL };
}
