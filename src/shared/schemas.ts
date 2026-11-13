// Gemeinsamer Vertrag zwischen Oberfläche und Server: Eingaben (zod) und Antworten (Typen).
import { z } from "zod";

export const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const isoDate = z.iso.date();
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Zeit als HH:MM");
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

/* ---------- Projekte ---------- */
export const projectCreate = z.object({
  id: id.optional(),
  name: text(120),
  sortOrder: z.number().int().optional(),
});
export const projectUpdate = projectCreate.omit({ id: true }).partial().extend({ archived: z.boolean().optional() });

/* ---------- Aufgaben ---------- */
export const priority = z.number().int().min(1).max(4);
export const recurrence = z
  .string()
  .trim()
  .max(500)
  .regex(/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Za-z0-9,+-]+)*$/, "Wiederholung als RRULE, z.B. FREQ=WEEKLY;BYDAY=TH");

export const taskCreate = z.object({
  id: id.optional(),
  title: text(500),
  notes: optText(10_000),
  projectId: id.nullable().optional(),
  parentId: id.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  dueTime: clockTime.nullable().optional(),
  priority: priority.optional(),
  recurrence: recurrence.nullable().optional(),
  durationMin: z.number().int().min(1).max(24 * 60).nullable().optional(),
  examId: id.nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export const taskUpdate = taskCreate.omit({ id: true }).partial().extend({ done: z.boolean().optional() });
export const taskQuery = z.object({
  view: z.enum(["all", "today"]).default("all"),
  examId: id.optional(),
  parentId: id.optional(),
});

/* ---------- Fächer ---------- */
export const subjectCreate = z.object({ id: id.optional(), code: text(20), name: optText(120), sortOrder: z.number().int().optional() });

/* ---------- Prüfungen ---------- */
export const examStatus = z.enum(["bestaetigt", "unbestaetigt"]);
export const assessment = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const examFields = {
  title: text(300),
  date: isoDate,
  startTime: clockTime.nullable().optional(),
  endTime: clockTime.nullable().optional(),
  room: optText(40),
  source: optText(500),
  status: examStatus.optional(),
  hint: optText(200),
};
export const examCreate = z
  .object({
    id: id.optional(),
    subjectId: id.optional(),
    subjectCode: text(20).optional(),
    ...examFields,
    topics: z.array(text(300)).max(100).optional(),
  })
  .refine((v) => v.subjectId || v.subjectCode, { message: "subjectId oder subjectCode nötig", path: ["subjectId"] });
export const examUpdate = z.object({ subjectId: id.optional(), ...examFields }).partial();

export const examTopicCreate = z.object({ id: id.optional(), title: text(300), assessment: assessment.optional(), sortOrder: z.number().int().optional() });
export const examTopicUpdate = examTopicCreate.omit({ id: true }).partial();

/* ---------- Noten ---------- */
export const gradeCreate = z
  .object({
    id: id.optional(),
    subjectId: id.optional(),
    subjectCode: text(20).optional(),
    title: optText(300),
    value: z.number().min(1).max(6),
    weight: z.number().positive().max(100).optional(),
    date: isoDate,
    source: optText(500),
    isNew: z.boolean().optional(),
  })
  .refine((v) => v.subjectId || v.subjectCode, { message: "subjectId oder subjectCode nötig", path: ["subjectId"] });
export const gradeUpdate = z
  .object({
    subjectId: id,
    title: optText(300),
    value: z.number().min(1).max(6),
    weight: z.number().positive().max(100),
    date: isoDate,
    source: optText(500),
    isNew: z.boolean(),
  })
  .partial();
export const gradeQuery = z.object({ subjectId: id.optional() });

/* ---------- Gewohnheiten ---------- */
export const cadence = z.enum(["daily", "weekly", "monthly"]);
export const habitCreate = z.object({
  id: id.optional(),
  name: text(200),
  cadence: cadence.optional(),
  target: z.number().positive().max(1_000_000).nullable().optional(),
  unit: optText(30),
  sortOrder: z.number().int().optional(),
});
export const habitUpdate = habitCreate.omit({ id: true }).partial().extend({ archived: z.boolean().optional() });
/** Eintrag pro Tag; ein zweiter Eintrag am selben Tag überschreibt den Wert. */
export const habitLogUpsert = z.object({ day: isoDate, value: z.number().min(0).max(1_000_000).optional() });
export const habitLogUpdate = z.object({ value: z.number().min(0).max(1_000_000) });
export const habitLogQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/* ---------- Ziele ---------- */
export const goalCreate = z.object({
  id: id.optional(),
  title: text(300),
  area: text(40),
  target: z.number().nullable().optional(),
  current: z.number().nullable().optional(),
  deadline: isoDate.nullable().optional(),
});
export const goalUpdate = goalCreate.omit({ id: true }).partial();
export const goalQuery = z.object({ area: z.string().max(40).optional() });

export const syncRunQuery = z.object({ kind: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(10) });

/* ---------- Antworten ---------- */
export type ExamStatus = z.infer<typeof examStatus>;
export type Assessment = z.infer<typeof assessment>;

interface Stamped {
  createdAt: string;
  updatedAt: string;
}

export interface Project extends Stamped {
  id: string;
  name: string;
  sortOrder: number;
  archived: boolean;
}

export interface Task extends Stamped {
  id: string;
  title: string;
  notes: string | null;
  projectId: string | null;
  parentId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: number;
  recurrence: string | null;
  durationMin: number | null;
  examId: string | null;
  doneAt: string | null;
  sortOrder: number;
}

export interface Subject extends Stamped {
  id: string;
  code: string;
  name: string | null;
  sortOrder: number;
}

export interface ExamTopic extends Stamped {
  id: string;
  examId: string;
  title: string;
  assessment: Assessment;
  sortOrder: number;
}

export interface Exam extends Stamped {
  id: string;
  subjectId: string;
  subjectCode: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  source: string | null;
  status: ExamStatus;
  hint: string | null;
  topicCount: number;
  topicsSolid: number;
}

export interface ExamDetail extends Exam {
  topics: ExamTopic[];
}

export interface Grade extends Stamped {
  id: string;
  subjectId: string;
  title: string | null;
  value: number;
  weight: number;
  date: string;
  source: string | null;
  isNew: boolean;
}

export interface SyncRun {
  id: string;
  kind: string;
  at: string;
  ok: boolean;
  message: string | null;
}

export type Cadence = z.infer<typeof cadence>;

export interface Habit extends Stamped {
  id: string;
  name: string;
  cadence: Cadence;
  target: number | null;
  unit: string | null;
  archived: boolean;
  sortOrder: number;
}

export interface HabitLog extends Stamped {
  id: string;
  habitId: string;
  day: string;
  value: number;
}

export interface Goal extends Stamped {
  id: string;
  title: string;
  area: string;
  target: number | null;
  current: number | null;
  deadline: string | null;
}

export interface ApiError {
  error: string;
  issues?: unknown;
}

export type TaskCreate = z.input<typeof taskCreate>;
export type TaskUpdate = z.input<typeof taskUpdate>;
export type ExamCreate = z.input<typeof examCreate>;
export type ExamUpdate = z.input<typeof examUpdate>;
export type ExamTopicCreate = z.input<typeof examTopicCreate>;
export type ExamTopicUpdate = z.input<typeof examTopicUpdate>;
export type GradeCreate = z.input<typeof gradeCreate>;
export type GradeUpdate = z.input<typeof gradeUpdate>;
export type ProjectCreate = z.input<typeof projectCreate>;
export type HabitCreate = z.input<typeof habitCreate>;
export type HabitUpdate = z.input<typeof habitUpdate>;
export type HabitLogUpsert = z.input<typeof habitLogUpsert>;
export type GoalCreate = z.input<typeof goalCreate>;
export type GoalUpdate = z.input<typeof goalUpdate>;
export type ProjectUpdate = z.input<typeof projectUpdate>;
