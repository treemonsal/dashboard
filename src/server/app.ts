import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, getTableColumns, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { z } from "zod";
import * as schema from "./db/schema";
import { checkAccess, type AuthEnv } from "./auth";
import {
  examCreate,
  examTopicCreate,
  examTopicUpdate,
  examUpdate,
  gradeCreate,
  gradeQuery,
  gradeUpdate,
  goalCreate,
  goalQuery,
  goalUpdate,
  habitCreate,
  habitLogQuery,
  habitLogUpdate,
  habitLogUpsert,
  habitUpdate,
  id as idSchema,
  isoDate,
  projectCreate,
  projectUpdate,
  subjectCreate,
  syncRunQuery,
  taskCreate,
  taskQuery,
  taskUpdate,
  type Exam,
  type ExamDetail,
} from "../shared/schemas";
import { todayInZone, zoneMidnightUtc } from "../shared/dates";
import { z as zod } from "zod";

const { exams, examTopics, goals, grades, habitLogs, habits, projects, subjects, syncRuns, tasks } = schema;

export interface Bindings extends AuthEnv {
  DB: D1Database;
  ASSETS: Fetcher;
}

type Db = DrizzleD1Database<typeof schema>;
type AppEnv = { Bindings: Bindings; Variables: { db: Db; email: string } };

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

/** Validierung mit einheitlicher Fehlerantwort. */
function v<T extends z.ZodType, K extends "json" | "query" | "param">(target: K, s: T) {
  return zValidator(target, s, (r, c) => {
    if (!r.success) return c.json({ error: "Ungültige Eingabe", issues: r.error.issues }, 400);
  });
}
const idParam = zod.object({ id: idSchema });

function notFound(c: Context) {
  return c.json({ error: "Nicht gefunden" }, 404);
}

async function subjectIdFrom(db: Db, input: { subjectId?: string; subjectCode?: string }): Promise<string | null> {
  if (input.subjectId) return input.subjectId;
  const row = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.code, input.subjectCode!)).get();
  return row?.id ?? null;
}

const examColumns = {
  ...getTableColumns(exams),
  subjectCode: subjects.code,
  topicCount: sql<number>`(select count(*) from exam_topics t where t.exam_id = ${exams.id})`.mapWith(Number),
  topicsSolid: sql<number>`(select count(*) from exam_topics t where t.exam_id = ${exams.id} and t.assessment = 2)`.mapWith(Number),
};

async function loadExam(db: Db, examId: string): Promise<ExamDetail | null> {
  const exam = await db.select(examColumns).from(exams).innerJoin(subjects, eq(subjects.id, exams.subjectId)).where(eq(exams.id, examId)).get();
  if (!exam) return null;
  const topics = await db.select().from(examTopics).where(eq(examTopics.examId, examId)).orderBy(asc(examTopics.sortOrder), asc(examTopics.createdAt));
  return { ...(exam as Exam), topics: topics as ExamDetail["topics"] };
}

export function createApp() {
  const app = new Hono<AppEnv>();

  // Sicherheitskopfzeilen für jede Antwort, auch für die Oberfläche.
  app.use("*", async (c, next) => {
    await next();
    const h = new Headers(c.res.headers);
    h.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "no-referrer");
    h.set("X-Frame-Options", "DENY");
    if (c.req.path.startsWith("/api/")) h.set("Cache-Control", "no-store");
    c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers: h });
  });

  // Login für jede Route, auch für die Oberfläche und spätere Endpunkte.
  app.use("*", async (c, next) => {
    const r = await checkAccess(c.req.raw, c.env);
    if (!r.ok) {
      if (c.req.path.startsWith("/api/")) return c.json({ error: r.reason }, r.status);
      return c.text(r.reason, r.status);
    }
    c.set("email", r.email);
    c.set("db", drizzle(c.env.DB, { schema }));
    await next();
  });

  app.onError((err, c) => {
    // Drizzle verpackt D1-Fehler; die eigentliche Meldung steht in cause.
    const e = err as Error & { cause?: unknown };
    const msg = `${e?.message ?? err} ${e?.cause instanceof Error ? e.cause.message : (e?.cause ?? "")}`;
    if (/FOREIGN KEY|CHECK constraint|UNIQUE constraint|NOT NULL constraint/i.test(msg)) {
      return c.json({ error: "Ungültige Verknüpfung oder doppelter Eintrag" }, 400);
    }
    console.error(err);
    return c.json({ error: "Serverfehler" }, 500);
  });

  const api = new Hono<AppEnv>();

  /* ---------- Projekte ---------- */
  api.get("/projects", async (c) => c.json(await c.var.db.select().from(projects).orderBy(asc(projects.sortOrder), asc(projects.name))));
  api.post("/projects", v("json", projectCreate), async (c) => {
    const b = c.req.valid("json");
    const row = await c.var.db.insert(projects).values({ ...b, id: b.id ?? newId() }).returning().get();
    return c.json(row, 201);
  });
  api.patch("/projects/:id", v("param", idParam), v("json", projectUpdate), async (c) => {
    const row = await c.var.db
      .update(projects)
      .set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(projects.id, c.req.valid("param").id))
      .returning()
      .get();
    return row ? c.json(row) : notFound(c);
  });

  /* ---------- Aufgaben ---------- */
  api.get("/tasks", v("query", taskQuery), async (c) => {
    const q = c.req.valid("query");
    const where: (SQL | undefined)[] = [];
    if (q.view === "today") {
      const today = todayInZone();
      where.push(lte(tasks.dueDate, today), isNull(tasks.parentId), or(isNull(tasks.doneAt), gte(tasks.doneAt, zoneMidnightUtc(today))));
    }
    if (q.examId) where.push(eq(tasks.examId, q.examId));
    if (q.parentId) where.push(eq(tasks.parentId, q.parentId));
    const rows = await c.var.db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(asc(tasks.dueDate), sql`${tasks.dueTime} is null`, asc(tasks.dueTime), asc(tasks.priority), asc(tasks.sortOrder), asc(tasks.createdAt));
    return c.json(rows);
  });
  api.get("/tasks/:id", v("param", idParam), async (c) => {
    const row = await c.var.db.select().from(tasks).where(eq(tasks.id, c.req.valid("param").id)).get();
    return row ? c.json(row) : notFound(c);
  });
  api.post("/tasks", v("json", taskCreate), async (c) => {
    const b = c.req.valid("json");
    const row = await c.var.db
      .insert(tasks)
      .values({ ...b, id: b.id ?? newId() })
      .returning()
      .get();
    return c.json(row, 201);
  });
  api.patch("/tasks/:id", v("param", idParam), v("json", taskUpdate), async (c) => {
    const { done, ...rest } = c.req.valid("json");
    const taskId = c.req.valid("param").id;
    if (rest.parentId === taskId) return c.json({ error: "Eine Aufgabe kann nicht ihre eigene Unteraufgabe sein" }, 400);
    const set: Partial<typeof tasks.$inferInsert> = { ...rest, updatedAt: nowIso() };
    if (done !== undefined) {
      const current = await c.var.db.select({ doneAt: tasks.doneAt }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!current) return notFound(c);
      // Bereits erledigte Aufgaben behalten ihren ursprünglichen Zeitpunkt.
      set.doneAt = done ? (current.doneAt ?? nowIso()) : null;
    }
    const row = await c.var.db.update(tasks).set(set).where(eq(tasks.id, taskId)).returning().get();
    return row ? c.json(row) : notFound(c);
  });

  /* ---------- Fächer ---------- */
  api.get("/subjects", async (c) => c.json(await c.var.db.select().from(subjects).orderBy(asc(subjects.sortOrder), asc(subjects.code))));
  api.post("/subjects", v("json", subjectCreate), async (c) => {
    const b = c.req.valid("json");
    return c.json(await c.var.db.insert(subjects).values({ ...b, id: b.id ?? newId() }).returning().get(), 201);
  });

  /* ---------- Prüfungen ---------- */
  api.get("/exams", v("query", zod.object({ from: isoDate.optional() })), async (c) => {
    const { from } = c.req.valid("query");
    const rows = await c.var.db
      .select(examColumns)
      .from(exams)
      .innerJoin(subjects, eq(subjects.id, exams.subjectId))
      .where(from ? gte(exams.date, from) : undefined)
      .orderBy(asc(exams.date), sql`${exams.startTime} is null`, asc(exams.startTime));
    return c.json(rows);
  });
  api.get("/exams/:id", v("param", idParam), async (c) => {
    const exam = await loadExam(c.var.db, c.req.valid("param").id);
    return exam ? c.json(exam) : notFound(c);
  });
  api.post("/exams", v("json", examCreate), async (c) => {
    const { topics, subjectCode: _code, subjectId: _sid, ...b } = c.req.valid("json");
    const subjectId = await subjectIdFrom(c.var.db, c.req.valid("json"));
    if (!subjectId) return c.json({ error: "Fach nicht gefunden" }, 400);
    const examId = b.id ?? newId();
    const stmts = [
      c.var.db.insert(exams).values({ ...b, id: examId, subjectId }),
      ...(topics ?? []).map((title, i) => c.var.db.insert(examTopics).values({ id: newId(), examId, title, sortOrder: i })),
    ];
    await c.var.db.batch(stmts as [(typeof stmts)[0], ...typeof stmts]);
    return c.json(await loadExam(c.var.db, examId), 201);
  });
  api.patch("/exams/:id", v("param", idParam), v("json", examUpdate), async (c) => {
    const examId = c.req.valid("param").id;
    const row = await c.var.db
      .update(exams)
      .set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(exams.id, examId))
      .returning({ id: exams.id })
      .get();
    return row ? c.json(await loadExam(c.var.db, examId)) : notFound(c);
  });

  /* ---------- Themen einer Prüfung ---------- */
  api.get("/exams/:id/topics", v("param", idParam), async (c) => {
    const rows = await c.var.db
      .select()
      .from(examTopics)
      .where(eq(examTopics.examId, c.req.valid("param").id))
      .orderBy(asc(examTopics.sortOrder), asc(examTopics.createdAt));
    return c.json(rows);
  });
  api.post("/exams/:id/topics", v("param", idParam), v("json", examTopicCreate), async (c) => {
    const examId = c.req.valid("param").id;
    const exists = await c.var.db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId)).get();
    if (!exists) return notFound(c);
    const b = c.req.valid("json");
    let sortOrder = b.sortOrder;
    if (sortOrder === undefined) {
      const max = await c.var.db
        .select({ m: sql<number>`coalesce(max(${examTopics.sortOrder}), -1)` })
        .from(examTopics)
        .where(eq(examTopics.examId, examId))
        .get();
      sortOrder = (max?.m ?? -1) + 1;
    }
    const row = await c.var.db
      .insert(examTopics)
      .values({ ...b, id: b.id ?? newId(), examId, sortOrder })
      .returning()
      .get();
    return c.json(row, 201);
  });
  api.patch("/exam-topics/:id", v("param", idParam), v("json", examTopicUpdate), async (c) => {
    const row = await c.var.db
      .update(examTopics)
      .set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(examTopics.id, c.req.valid("param").id))
      .returning()
      .get();
    return row ? c.json(row) : notFound(c);
  });

  /* ---------- Noten ---------- */
  api.get("/grades", v("query", gradeQuery), async (c) => {
    const { subjectId } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(grades)
      .where(subjectId ? eq(grades.subjectId, subjectId) : undefined)
      .orderBy(desc(grades.date), desc(grades.createdAt));
    return c.json(rows);
  });
  api.post("/grades", v("json", gradeCreate), async (c) => {
    const { subjectCode: _code, subjectId: _sid, ...b } = c.req.valid("json");
    const subjectId = await subjectIdFrom(c.var.db, c.req.valid("json"));
    if (!subjectId) return c.json({ error: "Fach nicht gefunden" }, 400);
    const row = await c.var.db
      .insert(grades)
      .values({ ...b, id: b.id ?? newId(), subjectId })
      .returning()
      .get();
    return c.json(row, 201);
  });
  api.patch("/grades/:id", v("param", idParam), v("json", gradeUpdate), async (c) => {
    const row = await c.var.db
      .update(grades)
      .set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(grades.id, c.req.valid("param").id))
      .returning()
      .get();
    return row ? c.json(row) : notFound(c);
  });

  /* ---------- Gewohnheiten ---------- */
  api.get("/habits", async (c) => c.json(await c.var.db.select().from(habits).orderBy(asc(habits.sortOrder), asc(habits.createdAt))));
  api.post("/habits", v("json", habitCreate), async (c) => {
    const b = c.req.valid("json");
    return c.json(await c.var.db.insert(habits).values({ ...b, id: b.id ?? newId() }).returning().get(), 201);
  });
  api.patch("/habits/:id", v("param", idParam), v("json", habitUpdate), async (c) => {
    const row = await c.var.db
      .update(habits)
      .set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(habits.id, c.req.valid("param").id))
      .returning()
      .get();
    return row ? c.json(row) : notFound(c);
  });
  api.get("/habits/:id/logs", v("param", idParam), v("query", habitLogQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, c.req.valid("param").id), from ? gte(habitLogs.day, from) : undefined, to ? lte(habitLogs.day, to) : undefined))
      .orderBy(asc(habitLogs.day));
    return c.json(rows);
  });
  api.post("/habits/:id/logs", v("param", idParam), v("json", habitLogUpsert), async (c) => {
    const habitId = c.req.valid("param").id;
    const exists = await c.var.db.select({ id: habits.id }).from(habits).where(eq(habits.id, habitId)).get();
    if (!exists) return notFound(c);
    const { day, value = 1 } = c.req.valid("json");
    const row = await c.var.db
      .insert(habitLogs)
      .values({ id: newId(), habitId, day, value })
      .onConflictDoUpdate({ target: [habitLogs.habitId, habitLogs.day], set: { value, updatedAt: nowIso() } })
      .returning()
      .get();
    return c.json(row, 201);
  });
  api.patch("/habit-logs/:id", v("param", idParam), v("json", habitLogUpdate), async (c) => {
    const row = await c.var.db
      .update(habitLogs)
      .set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(habitLogs.id, c.req.valid("param").id))
      .returning()
      .get();
    return row ? c.json(row) : notFound(c);
  });

  /* ---------- Ziele ---------- */
  api.get("/goals", v("query", goalQuery), async (c) => {
    const { area } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(goals)
      .where(area ? eq(goals.area, area) : undefined)
      .orderBy(sql`${goals.deadline} is null`, asc(goals.deadline), asc(goals.createdAt));
    return c.json(rows);
  });
  api.post("/goals", v("json", goalCreate), async (c) => {
    const b = c.req.valid("json");
    return c.json(await c.var.db.insert(goals).values({ ...b, id: b.id ?? newId() }).returning().get(), 201);
  });
  api.patch("/goals/:id", v("param", idParam), v("json", goalUpdate), async (c) => {
    const row = await c.var.db
      .update(goals)
      .set({ ...c.req.valid("json"), updatedAt: nowIso() })
      .where(eq(goals.id, c.req.valid("param").id))
      .returning()
      .get();
    return row ? c.json(row) : notFound(c);
  });

  /* ---------- Abgleiche ---------- */
  api.get("/sync-runs", v("query", syncRunQuery), async (c) => {
    const { kind, limit } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(syncRuns)
      .where(kind ? eq(syncRuns.kind, kind) : undefined)
      .orderBy(desc(syncRuns.at))
      .limit(limit);
    return c.json(rows);
  });

  api.all("*", (c) => c.json({ error: "Nicht gefunden" }, 404));
  app.route("/api", api);

  // Alles andere: Oberfläche aus den statischen Dateien (SPA-Fallback übernimmt Cloudflare).
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
