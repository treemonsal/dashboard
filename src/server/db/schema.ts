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
  // false: Noten stehen nur zur Information da, zählen weder zum Schnitt noch zum Zeugnis
  counts: integer("counts", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

// Stundenplan (wöchentlich wiederkehrende Lektionen); wird vollständig ersetzt
export const timetable = sqliteTable(
  "timetable",
  {
    id: text("id").primaryKey(),
    weekday: integer("weekday").notNull(), // 1 = Montag bis 7 = Sonntag
    startTime: text("start_time").notNull(), // HH:MM
    endTime: text("end_time").notNull(), // HH:MM
    subject: text("subject").notNull(), // Fach-Kürzel als Text
    room: text("room"),
    teacher: text("teacher"),
    validFrom: text("valid_from"), // YYYY-MM-DD
    ...timestamps,
  },
  (t) => [check("timetable_weekday_chk", sql`${t.weekday} between 1 and 7`)],
);

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
    // Eigene Notiz des Besitzers (Themenseite) und Zusammenfassung, die später über den Connector eingetragen wird
    notes: text("notes"),
    summary: text("summary"),
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
    // Herkunft ist eindeutig; alte, nicht verknüpfte Aufgaben werden niemals beim Rückgängigmachen gelöscht.
    predecessorId: text("predecessor_id").references((): AnySQLiteColumn => tasks.id, { onDelete: "set null" }),
    recurrenceUntouched: integer("recurrence_untouched", { mode: "boolean" }).notNull().default(false),
    mutationId: text("mutation_id").notNull().default(""),
    durationMin: integer("duration_min"),
    examId: text("exam_id").references(() => exams.id, { onDelete: "set null" }),
    doneAt: text("done_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tasks_predecessor_uq").on(t.predecessorId),
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

/* ---------- Einstellungen ---------- */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

/* ---------- Lernen aus dem Alltag: ein Eintrag pro Erledigen ---------- */
export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD, Europe/Zurich
    weekday: integer("weekday").notNull(), // 0 = Sonntag ... 6 = Samstag
    plannedTime: text("planned_time"), // HH:MM laut Plan
    doneTime: text("done_time").notNull(), // HH:MM tatsächlich
    durationMin: integer("duration_min"), // tatsächliche Dauer, sonst geplante
    plannedMin: integer("planned_min"),
    ...timestamps,
  },
  (t) => [index("task_events_task_idx").on(t.taskId), index("task_events_day_idx").on(t.day)],
);

/* ---------- Gym ---------- */
export const gymPlans = sqliteTable("gym_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Wochentage als Komma-Liste, 0 = Sonntag ... 6 = Samstag, z.B. "1,3,5"
  weekdays: text("weekdays").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const gymExercises = sqliteTable(
  "gym_exercises",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull().references(() => gymPlans.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sets: integer("sets").notNull().default(3),
    reps: integer("reps").notNull().default(10),
    weight: real("weight"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("gym_exercises_plan_idx").on(t.planId)],
);

export const gymSessions = sqliteTable(
  "gym_sessions",
  {
    id: text("id").primaryKey(),
    day: text("day").notNull(), // YYYY-MM-DD
    planId: text("plan_id").references(() => gymPlans.id, { onDelete: "set null" }),
    planName: text("plan_name"),
    finishedAt: text("finished_at"),
    ...timestamps,
  },
  (t) => [uniqueIndex("gym_sessions_day_uq").on(t.day)],
);

export const gymSets = sqliteTable(
  "gym_sets",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => gymSessions.id, { onDelete: "cascade" }),
    exerciseName: text("exercise_name").notNull(),
    exerciseOrder: integer("exercise_order").notNull().default(0),
    setIndex: integer("set_index").notNull().default(0),
    reps: integer("reps").notNull().default(10),
    weight: real("weight"),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("gym_sets_session_idx").on(t.sessionId), index("gym_sets_name_idx").on(t.exerciseName)],
);

/* ---------- Geld (Parser folgt später; Tabellen und API stehen) ---------- */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  bank: text("bank"),
  currency: text("currency").notNull().default("CHF"),
  openingBalance: real("opening_balance").notNull().default(0),
  // Kennung aus dem Bank-Export (IBAN oder Bankname), damit weitere Uploads demselben Konto zugeordnet werden
  ref: text("ref"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    date: text("date").notNull(), // YYYY-MM-DD
    // Negativ = Ausgabe, positiv = Einnahme
    amount: real("amount").notNull(),
    description: text("description"),
    // Mahlzeit auswärts (Mittag-/Abendessen): die Mutter zahlt die Hälfte zurück
    mealOut: integer("meal_out", { mode: "boolean" }).notNull().default(false),
    // Eingehende Rückzahlung der Mutter: keine Einnahme, wird gegen offene Mahlzeiten verrechnet
    isRepayment: integer("is_repayment", { mode: "boolean" }).notNull().default(false),
    // null = automatische Erkennung, true/false = ausdrückliche manuelle Vorgabe.
    repaymentOverride: integer("repayment_override", { mode: "boolean" }),
    // Von Hand als beglichen markiert
    settledAt: text("settled_at"),
    // Bank-Import: Hash der Buchung (Doppelte werden übersprungen), Verbuchungszeit, Währung des Originals
    hash: text("hash"),
    bookedAt: text("booked_at"),
    currency: text("currency").notNull().default("CHF"),
    // Eigene Überweisung zwischen Konten oder Anlage: zählt nicht als Ausgabe
    internal: integer("internal", { mode: "boolean" }).notNull().default(false),
    // Von Hand (oder per Regel) festgelegt: Mahlzeit ja/nein. null = entscheidet die Schwelle.
    mealOverride: integer("meal_override", { mode: "boolean" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("transactions_hash_uq").on(t.hash), index("transactions_date_idx").on(t.date), index("transactions_account_idx").on(t.accountId), index("transactions_category_idx").on(t.categoryId)],
);

/* ---------- Körper ---------- */
export const healthDaily = sqliteTable("health_daily", {
  day: text("day").primaryKey(), // YYYY-MM-DD
  sleepMin: integer("sleep_min"),
  steps: integer("steps"),
  restingHr: integer("resting_hr"),
  weightKg: real("weight_kg"),
  source: text("source").notNull().default("manual"),
  ...timestamps,
});

export const investmentEntries = sqliteTable(
  "investment_entries",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["value", "deposit"] }).notNull(),
    date: text("date").notNull(),
    amount: real("amount").notNull(),
    note: text("note"),
    // 1 = vom täglichen Lauf aus Kursen fortgeschrieben ("geschätzt"), 0 = von Hand oder genau berechnet
    estimated: integer("estimated", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("investment_entries_date_idx").on(t.date), check("investment_entries_kind_chk", sql`${t.kind} in ('value','deposit')`)],
);

/* ---------- Gelernte Kategorie-Regeln ---------- */
export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    pattern: text("pattern").notNull(),
    category: text("category").notNull(),
    wholeWord: integer("whole_word", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("category_rules_pattern_uq").on(t.pattern)],
);

/* ---------- Kalender (nur lesen): geheime iCal-Adresse und abgeglichene Termine ---------- */
export const calendars = sqliteTable("calendars", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // GEHEIM: Zugangsschlüssel zum Kalender. Nie in Export, Logs oder Antworten.
  url: text("url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
    uid: text("uid").notNull(),
    title: text("title").notNull(),
    // Lokales Datum und lokale Zeit in Europe/Zurich; Ende ganztägig = letzter Tag
    startDate: text("start_date").notNull(),
    startTime: text("start_time"),
    endDate: text("end_date").notNull(),
    endTime: text("end_time"),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    location: text("location"),
    description: text("description"),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("calendar_events_start_idx").on(t.startDate), index("calendar_events_cal_idx").on(t.calendarId)],
);

/* ---------- Web Push ---------- */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint)],
);

/** Gesendete Erinnerungen: der Schlüssel verhindert, dass eine Erinnerung zweimal rausgeht. */
export const sentReminders = sqliteTable("sent_reminders", {
  key: text("key").primaryKey(),
  sentAt: text("sent_at").notNull().default(now),
});

/* ---------- Gesundheit: Verbindung zu Google Health (src/server/health) ---------- */
// Eine Zeile (id = Anbieter). Tokens liegen nur verschlüsselt (AES-GCM, Schlüssel = Secret HEALTH_TOKEN_KEY).
export const healthConnection = sqliteTable("health_connection", {
  id: text("id").primaryKey(),
  refreshEnc: text("refresh_enc").notNull(),
  accessEnc: text("access_enc"),
  accessExpiresAt: text("access_expires_at"),
  scope: text("scope"),
  connectedAt: text("connected_at").notNull().default(now),
  syncThrough: text("sync_through"), // exklusives Ende des letzten vollständig gelesenen Bereichs
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull().default(now),
});

// Zugangsdaten (OAuth-Client) aus der App, eine Zeile pro Anbieter. ID und Secret nur verschlüsselt (AES-GCM, Schlüssel HEALTH_TOKEN_KEY);
// idTail = letzte 4 Zeichen der ID, die einzige Angabe, die je angezeigt wird.
export const healthCredentials = sqliteTable("health_credentials", {
  id: text("id").primaryKey(),
  clientIdEnc: text("client_id_enc").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  idTail: text("id_tail").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

// Laufende Anmeldungen (state + PKCE-Verifier), höchstens 10 Minuten gültig, einmal verwendbar.
export const healthOauthState = sqliteTable("health_oauth_state", {
  state: text("state").primaryKey(),
  verifier: text("verifier").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

// Trainings aus Google Health; day = Tag des Trainingsbeginns in Europe/Zurich.
export const healthWorkouts = sqliteTable(
  "health_workouts",
  {
    id: text("id").primaryKey(), // Hash aus Anbieter und Startzeit
    day: text("day").notNull(),
    startAt: text("start_at").notNull(),
    endAt: text("end_at"),
    type: text("type").notNull(),
    name: text("name"),
    minutes: integer("minutes"),
    kcal: integer("kcal"),
    avgHr: integer("avg_hr"),
    source: text("source").notNull().default("fitbit"),
    ...timestamps,
  },
  (t) => [index("health_workouts_day_idx").on(t.day)],
);

// Eine Nacht aus Google Health (Schlaf zählt zum Tag des Aufwachens). Zeiten als UTC-ISO, Minuten je Phase falls geliefert.
export const healthSleep = sqliteTable("health_sleep", {
  day: text("day").primaryKey(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  asleepMin: integer("asleep_min"),
  awakeMin: integer("awake_min"),
  deepMin: integer("deep_min"),
  lightMin: integer("light_min"),
  remMin: integer("rem_min"),
  ...timestamps,
});
