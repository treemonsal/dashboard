// Welche Erinnerungen jetzt fällig sind. Reine Logik: Der Worker liefert die Daten, hier wird nur entschieden.
// Jede Erinnerung hat einen Schlüssel; der Aufrufer merkt sich gesendete Schlüssel und sendet nie zweimal.
import { addDays, clockOf, minutesOf, timeInZone, todayInZone, weekdayNum } from "./dates";

export interface ReminderTask {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  doneAt: string | null;
  parentId: string | null;
}
export interface ReminderExam {
  id: string;
  date: string;
  startTime: string | null;
  subjectCode: string;
}
export interface ReminderPlan {
  name: string;
  weekdays: number[];
}
export interface ReminderInput {
  now: Date;
  /** Schlafenszeit aus den Einstellungen, "HH:MM". */
  sleepTime: string;
  tasks: ReminderTask[];
  plans: ReminderPlan[];
  /** Heute schon ein abgeschlossenes Training? */
  trainingDoneToday: boolean;
  exams: ReminderExam[];
}
export interface Reminder {
  key: string;
  title: string;
  body: string;
  /** Wird beim Antippen geöffnet. */
  url: string;
  /** Gleiche Kennung ersetzt eine frühere Mitteilung. */
  tag: string;
}

/** Zeitpunkte der Erinnerungen (Minuten) und wie lange sie nach Ablauf noch gelten, falls ein Lauf ausfällt. */
export const TASK_LEAD_MIN = 10;
export const TRAINING_AT = "17:00";
export const TRAINING_GRACE_MIN = 60;
export const EXAM_AT = "18:00";
export const EXAM_GRACE_MIN = 120;
export const SLEEP_LEAD_MIN = 30;

export function dueReminders(i: ReminderInput): Reminder[] {
  const today = todayInZone(i.now);
  const nowMin = minutesOf(timeInZone(i.now));
  const out: Reminder[] = [];

  // Aufgaben mit Uhrzeit: 10 Minuten vorher, bis zur Uhrzeit selbst.
  for (const t of i.tasks) {
    if (t.parentId || t.doneAt || t.dueDate !== today || !t.dueTime) continue;
    const at = minutesOf(t.dueTime);
    if (nowMin >= at - TASK_LEAD_MIN && nowMin < at) {
      out.push({ key: `task:${t.id}:${today}:${t.dueTime}`, title: t.title, body: `${at - nowMin === 1 ? "In 1 Minute" : `In ${at - nowMin} Minuten`}, ${t.dueTime}`, url: "/", tag: `task-${t.id}` });
    }
  }

  // Training am Trainingstag um 17:00, falls noch nicht erledigt.
  const plan = i.plans.find((p) => p.weekdays.includes(weekdayNum(today)));
  const trainingOpen = !!plan && !i.trainingDoneToday;
  const tAt = minutesOf(TRAINING_AT);
  if (trainingOpen && nowMin >= tAt && nowMin < tAt + TRAINING_GRACE_MIN) {
    out.push({ key: `training:${today}`, title: "Training heute", body: plan!.name, url: "/", tag: "training" });
  }

  // Prüfung am Vorabend um 18:00.
  const morgen = addDays(today, 1);
  const eAt = minutesOf(EXAM_AT);
  if (nowMin >= eAt && nowMin < eAt + EXAM_GRACE_MIN) {
    for (const e of i.exams.filter((x) => x.date === morgen)) {
      out.push({ key: `exam:${e.id}`, title: "Prüfung morgen", body: e.startTime ? `${e.subjectCode}, ${e.startTime}` : e.subjectCode, url: "/", tag: `exam-${e.id}` });
    }
  }

  // Eine halbe Stunde vor dem Schlafen, falls heute noch etwas offen ist.
  const sAt = minutesOf(i.sleepTime) - SLEEP_LEAD_MIN;
  if (nowMin >= sAt && nowMin < sAt + SLEEP_LEAD_MIN) {
    const open = i.tasks.some((t) => !t.parentId && !t.doneAt && t.dueDate !== null && t.dueDate <= today) || trainingOpen;
    if (open) out.push({ key: `sleep:${today}`, title: `Schlafen um ${clockOf(minutesOf(i.sleepTime))}`, body: "Heute ist noch etwas offen.", url: "/", tag: "sleep" });
  }
  return out;
}
