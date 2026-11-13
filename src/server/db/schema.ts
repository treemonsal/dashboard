import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const timestamps = {
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
};

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  // Kürzel wie im Stundenplan, z.B. "W+R"
  code: text("code").notNull().unique(),
  name: text("name"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const exams = sqliteTable(
  "exams",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").notNull().references(() => subjects.id),
    title: text("title").notNull(),
    // Lokales Datum und lokale Zeit in Europe/Zurich
    date: text("date").notNull(), // YYYY-MM-DD
    startTime: text("start_time"), // HH:MM
    endTime: text("end_time"), // HH:MM
    room: text("room"),
    source: text("source"),
    status: text("status", { enum: ["bestaetigt", "unbestaetigt"] }).notNull().default("unbestaetigt"),
    hint: text("hint"),
    ...timestamps,
  },
  (t) => [index("exams_date_idx").on(t.date), check("exams_status_chk", sql`${t.status} in ('bestaetigt','unbestaetigt')`)],
);

export const examTopics = sqliteTable(
  "exam_topics",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // 0 = offen, 1 = unsicher, 2 = sitzt
    assessment: integer("assessment").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("exam_topics_exam_idx").on(t.examId), check("exam_topics_assessment_chk", sql`${t.assessment} in (0,1,2)`)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    notes: text("notes"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    // Unteraufgaben zeigen auf ihre Hauptaufgabe
    parentId: text("parent_id").references((): AnySQLiteColumn => tasks.id, { onDelete: "cascade" }),
    dueDate: text("due_date"), // YYYY-MM-DD, Europe/Zurich
    dueTime: text("due_time"), // HH:MM
    // 1 = höchste, 4 = keine
    priority: integer("priority").notNull().default(4),
    // Wiederholungsregel als RRULE-Text (RFC 5545), z.B. "FREQ=MONTHLY;BYMONTHDAY=1"
    recurrence: text("recurrence"),
    durationMin: integer("duration_min"),
    examId: text("exam_id").references(() => exams.id, { onDelete: "set null" }),
    doneAt: text("done_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("tasks_due_idx").on(t.dueDate),
    index("tasks_parent_idx").on(t.parentId),
    index("tasks_project_idx").on(t.projectId),
    check("tasks_priority_chk", sql`${t.priority} between 1 and 4`),
  ],
);

export const grades = sqliteTable(
  "grades",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").notNull().references(() => subjects.id),
    title: text("title"),
    value: real("value").notNull(),
    weight: real("weight").notNull().default(1),
    date: text("date").notNull(), // YYYY-MM-DD
    source: text("source"),
    isNew: integer("is_new", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("grades_subject_idx").on(t.subjectId),
    check("grades_value_chk", sql`${t.value} between 1 and 6`),
    check("grades_weight_chk", sql`${t.weight} > 0`),
  ],
);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // z.B. "schule"
  at: text("at").notNull().default(now),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  message: text("message"),
});

export const habits = sqliteTable(
  "habits",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Rhythmus: täglich, wöchentlich oder monatlich
    cadence: text("cadence", { enum: ["daily", "weekly", "monthly"] }).notNull().default("daily"),
    target: real("target"),
    unit: text("unit"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [check("habits_cadence_chk", sql`${t.cadence} in ('daily','weekly','monthly')`)],
);

export const habitLogs = sqliteTable(
  "habit_logs",
  {
    id: text("id").primaryKey(),
    habitId: text("habit_id").notNull().references(() => habits.id, { onDelete: "cascade" }),
    day: text("day").notNull(), // YYYY-MM-DD, Europe/Zurich
    value: real("value").notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("habit_logs_habit_day_uq").on(t.habitId, t.day)],
);

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  // Bereich, z.B. "schule", "finanzen", "gesundheit", "lehre", "persoenlich"
  area: text("area").notNull(),
  target: real("target"),
  current: real("current"),
  deadline: text("deadline"), // YYYY-MM-DD
  ...timestamps,
});
