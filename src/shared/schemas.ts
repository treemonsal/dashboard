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
export const taskUpdate = taskCreate
  .omit({ id: true })
  .partial()
  .extend({
    done: z.boolean().optional(),
    // Tatsächliche Dauer beim Erledigen; sonst gilt die geplante.
    actualMin: z.number().int().min(1).max(24 * 60).optional(),
  });
export const taskQuery = z.object({
  view: z.enum(["all", "today"]).default("all"),
  examId: id.optional(),
  parentId: id.optional(),
});

/* ---------- Fächer ---------- */
export const subjectCreate = z.object({ id: id.optional(), code: text(20), name: optText(120), sortOrder: z.number().int().optional(), counts: z.boolean().optional() });
export const subjectUpdate = z.object({ counts: z.boolean() }).strict();

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

/* ---------- Einstellungen ---------- */
export const weekdayList = z.string().regex(/^([0-6](,[0-6])*)?$/, "Wochentage als Liste 0 bis 6");
export const settingsUpdate = z
  .object({
    birthDate: z.union([isoDate, z.literal("")]),
    wakeTime: clockTime,
    sleepTime: clockTime,
    workDays: weekdayList,
    schoolDays: weekdayList,
    gymGoal: z.string().regex(/^[1-7]$/),
    salary: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/),
    investMonthly: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/),
    investStart: z.union([isoDate, z.literal("")]),
    investDay: z.string().regex(/^([1-9]|1\d|2[0-8])$/),
    investSymbol: z.string().trim().toUpperCase().regex(/^([A-Z0-9][A-Z0-9.\-]{0,11})?$/),
    investShares: z.string().regex(/^(\d{1,7}(\.\d{1,6})?)?$/),
    investCurrency: z.enum(["USD", "CHF", "EUR"]),
    mamaName: z.string().trim().max(60),
    hideHomework: z.enum(["0", "1"]),
    schoolHolidayUntil: z.union([isoDate, z.literal("")]),
    workoutView: z.enum(["sport", "alle"]),
  })
  .partial()
  .strict();
export type { Settings } from "./settings";
export { SETTING_DEFAULTS } from "./settings";

/* ---------- Stundenplan ---------- */
export const MAX_LESSONS = 80;
export const lessonWrite = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: clockTime,
    endTime: clockTime,
    subject: text(20),
    room: z.string().trim().max(40).nullish().transform((x) => x || null),
    teacher: z.string().trim().max(80).nullish().transform((x) => x || null),
    validFrom: isoDate.nullish().transform((x) => x ?? null),
  })
  .strict()
  .refine((l) => l.startTime < l.endTime, { message: "Ende muss nach dem Beginn liegen", path: ["endTime"] });
/** Vollständiger Stundenplan. Doppelte Lektionen (gleicher Tag, Beginn, Ende, Fach, gültig ab) sind ein Fehler. */
export const timetableReplace = z
  .object({ lessons: z.array(lessonWrite).max(MAX_LESSONS) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.lessons.forEach((l, i) => {
      const k = [l.weekday, l.startTime, l.endTime, l.subject.toLowerCase(), l.validFrom ?? ""].join("|");
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: "Doppelte Lektion", path: ["lessons", i] });
      seen.add(k);
    });
  });
export type LessonWrite = z.input<typeof lessonWrite>;
export interface TimetableLesson {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  subject: string;
  room: string | null;
  teacher: string | null;
  validFrom: string | null;
}

/* ---------- Lernplan ---------- */
export const studyPlanRequest = z.object({ replace: z.boolean().optional(), blockMin: z.number().int().min(10).max(240).optional() });

/* ---------- Gym ---------- */
const weekdayNum = z.number().int().min(0).max(6);
export const gymExerciseWrite = z.object({
  id: id.optional(),
  name: text(120),
  sets: z.number().int().min(1).max(12),
  reps: z.number().int().min(1).max(100),
  weight: z.number().min(0).max(1000).nullable().optional(),
});
export const gymPlanWrite = z.object({
  id: id.optional(),
  name: text(80),
  weekdays: z.array(weekdayNum).max(7),
  exercises: z.array(gymExerciseWrite).max(40),
});
export const gymSessionCreate = z.object({ planId: id.nullable().optional() });
export const gymSessionUpdate = z.object({ finished: z.boolean() });
export const gymSetUpdate = z.object({ done: z.boolean().optional(), weight: z.number().min(0).max(1000).nullable().optional(), reps: z.number().int().min(0).max(100).optional() });
export const gymDaysQuery = z.object({ from: isoDate, to: isoDate });

/* ---------- Geld ---------- */
export const accountCreate = z.object({ id: id.optional(), name: text(80), bank: optText(80), currency: text(3).optional(), openingBalance: z.number().optional(), sortOrder: z.number().int().optional() });
export const categoryCreate = z.object({ id: id.optional(), name: text(60), sortOrder: z.number().int().optional() });
export const transactionCreate = z.object({
  id: id.optional(),
  accountId: id,
  categoryId: id.nullable().optional(),
  date: isoDate,
  amount: z.number().min(-1e9).max(1e9),
  description: optText(300),
  mealOut: z.boolean().optional(),
  isRepayment: z.boolean().optional(),
});
export const transactionBulk = z.object({ transactions: z.array(transactionCreate).min(1).max(1000) });
export const transactionUpdate = transactionCreate.omit({ id: true }).partial().extend({ settled: z.boolean().optional() });
export const transactionQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) });

/* ---------- Depot ---------- */
export const investmentEntryCreate = z.object({
  id: id.optional(),
  // value = Depotwert an einem Tag, deposit = einmalige Einzahlung (z.B. bisher eingezahlt)
  kind: z.enum(["value", "deposit"]),
  date: isoDate,
  amount: z.number().min(0).max(1e9),
  note: optText(200),
});

/* ---------- Bank-Import ---------- */
const colIdx = z.number().int().min(0).max(200);
export const columnMapping = z.object({
  date: colIdx.optional(),
  valuta: colIdx.optional(),
  description: z.union([colIdx, z.array(colIdx).max(10)]).optional(),
  amount: colIdx.optional(),
  debit: colIdx.optional(),
  credit: colIdx.optional(),
  balance: colIdx.optional(),
  currency: colIdx.optional(),
  amountChf: colIdx.optional(),
  counterparty: colIdx.optional(),
  headerRow: colIdx.optional(),
  delimiter: z.string().max(2).optional(),
  defaultCurrency: z.string().max(3).optional(),
});
/** Vom Browser aus einem PDF gelesene Buchungen (das PDF selbst verlässt das Gerät nie). Hash und Konto setzt der Server selbst. */
export const pdfRows = z.object({
  bank: z.enum(["revolut", "zkb", "yuh", "unbekannt"]),
  account: z.string().max(40).optional(),
  /** Zahl unsicherer Zeilen aus dem Parser; grösser als 0 braucht `confirmed` */
  uncertain: z.number().int().min(0).max(100_000).default(0),
  confirmed: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        date: isoDate,
        description: z.string().max(400),
        amount: z.number().int().min(-1e12).max(1e12),
        currency: z.string().regex(/^[A-Z]{3}$/),
        amountChf: z.number().int().min(-1e12).max(1e12),
        balance: z.number().int().min(-1e12).max(1e12).optional(),
        chfEstimated: z.boolean().optional(),
      }),
    )
    .max(5000),
});
export const importRequest = z.object({
  files: z
    .array(z.object({ name: z.string().max(200), text: z.string().max(20_000_000).default(""), mapping: columnMapping.optional(), pdf: pdfRows.optional() }))
    .min(1)
    .max(12),
});
export interface ImportFilePreview {
  name: string;
  bank: string;
  account: string | null;
  total: number;
  fresh: number;
  duplicates: number;
  warnings: string[];
  needsConfirmation: boolean;
  header: string[] | null;
  mapping: z.infer<typeof columnMapping> | null;
  /** Erste neue Buchungen als Vorschau (Rappen) */
  sample: { date: string; description: string; amountChf: number; category: string }[];
}
export interface ImportPreview {
  files: ImportFilePreview[];
  fresh: number;
  duplicates: number;
}
export interface ImportResult extends ImportPreview {
  inserted: number;
}

/* ---------- Körper ---------- */
export const healthUpsert = z
  .object({
    sleepMin: z.number().int().min(0).max(1440).nullable(),
    steps: z.number().int().min(0).max(200_000).nullable(),
    restingHr: z.number().int().min(20).max(250).nullable(),
    weightKg: z.number().min(20).max(400).nullable(),
    source: z.enum(["manual", "fitbit"]),
  })
  .partial();
export const healthQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

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
  /** false: Noten nur zur Information, zählen weder zum Schnitt noch zum Zeugnis */
  counts: boolean;
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
export type SubjectUpdate = z.input<typeof subjectUpdate>;
export type GradeCreate = z.input<typeof gradeCreate>;
export type GradeUpdate = z.input<typeof gradeUpdate>;
export type ProjectCreate = z.input<typeof projectCreate>;
export type HabitCreate = z.input<typeof habitCreate>;
export type HabitUpdate = z.input<typeof habitUpdate>;
export type HabitLogUpsert = z.input<typeof habitLogUpsert>;
export type GoalCreate = z.input<typeof goalCreate>;
export type GoalUpdate = z.input<typeof goalUpdate>;
export type ProjectUpdate = z.input<typeof projectUpdate>;

export type SettingsUpdate = z.input<typeof settingsUpdate>;
export type GymPlanWrite = z.input<typeof gymPlanWrite>;
export type TransactionCreate = z.input<typeof transactionCreate>;
export type AccountCreate = z.input<typeof accountCreate>;
export type HealthUpsert = z.input<typeof healthUpsert>;

export interface GymExercise {
  id: string;
  planId: string;
  name: string;
  sets: number;
  reps: number;
  weight: number | null;
  sortOrder: number;
}
export interface GymPlan {
  id: string;
  name: string;
  weekdays: number[];
  sortOrder: number;
  exercises: GymExercise[];
}
export interface GymSet {
  id: string;
  sessionId: string;
  exerciseName: string;
  exerciseOrder: number;
  setIndex: number;
  reps: number;
  weight: number | null;
  done: boolean;
}
export interface GymSession {
  id: string;
  day: string;
  planId: string | null;
  planName: string | null;
  finishedAt: string | null;
  sets: GymSet[];
}
/** Alles, was die Oberfläche für einen Tag im Gym-Raster braucht. */
export interface GymDay {
  day: string;
  plan: GymPlan | null;
  session: GymSession | null;
}
export interface GymHistoryPoint {
  day: string;
  weight: number;
}

export interface Account {
  id: string;
  name: string;
  bank: string | null;
  currency: string;
  openingBalance: number;
  balance: number;
  sortOrder: number;
}
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}
export interface Transaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  date: string;
  amount: number;
  description: string | null;
  mealOut: boolean;
  isRepayment: boolean;
  settledAt: string | null;
  internal: boolean;
  currency: string;
}

export interface HealthDay {
  day: string;
  sleepMin: number | null;
  steps: number | null;
  restingHr: number | null;
  weightKg: number | null;
  source: "manual" | "fitbit";
}

export interface TaskEvent {
  id: string;
  taskId: string | null;
  title: string;
  day: string;
  weekday: number;
  plannedTime: string | null;
  doneTime: string;
  durationMin: number | null;
  plannedMin: number | null;
}

export type InvestmentEntryCreate = z.input<typeof investmentEntryCreate>;
export interface InvestmentEntry {
  id: string;
  kind: "value" | "deposit";
  date: string;
  amount: number;
  note: string | null;
  /** Fortgeschrieben aus Kursen, nicht von Hand */
  estimated: boolean;
}

/* ---------- Kalender (nur lesen) und Erinnerungen ---------- */
export const calendarCreate = z.object({
  id: id.optional(),
  name: text(60),
  // Die geheime Adresse; wird nur geprüft und gespeichert, nie zurückgegeben.
  url: z.string().trim().min(1).max(2000),
});
export const calendarEventQuery = z.object({ from: isoDate, to: isoDate });

export interface CalendarInfo {
  id: string;
  name: string;
  /** Gekürzt, z.B. "calendar.google.com/…/basic.ics". */
  urlMasked: string;
}
export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  uid: string;
  title: string;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
}
export interface CalendarSyncResult {
  ok: boolean;
  message: string;
  events: number;
}

export const pushSubscribe = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "Nur https"),
  keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(40) }),
});
export const pushUnsubscribe = z.object({ endpoint: z.string().max(1000) });
export interface PushResult {
  sent: number;
  removed: number;
  failed: number;
}
export type CalendarCreate = z.input<typeof calendarCreate>;
