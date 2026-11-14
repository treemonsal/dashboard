import { todayInZone, daysUntil, minutesOf } from "../shared/dates";
import type { Task, Grade, Subject } from "../shared/schemas";
import { countingAverage, weightedAverage } from "../shared/calc";

export const isDone = (t: Task) => t.doneAt !== null;
const doneToday = (t: Task, today: string) => t.doneAt !== null && todayInZone(new Date(t.doneAt)) === today;

/** Aufgaben für heute: fällig heute oder früher (offen), plus heute Erledigtes. Ohne Unteraufgaben. */
export function tasksToday(tasks: Task[], today: string): Task[] {
  return tasks
    .filter((t) => !t.parentId && t.dueDate !== null && t.dueDate <= today && (t.doneAt === null || doneToday(t, today)))
    .sort(byTime);
}
export function byTime(a: Task, b: Task) {
  if (!!a.doneAt !== !!b.doneAt && false) return 0;
  const ta = a.dueTime ? minutesOf(a.dueTime) : 9999;
  const tb = b.dueTime ? minutesOf(b.dueTime) : 9999;
  return (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || ta - tb || a.priority - b.priority || a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}
export const inbox = (tasks: Task[]) => tasks.filter((t) => !t.parentId && !t.doneAt && !t.dueDate && !t.projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
export const upcoming = (tasks: Task[], today: string) => tasks.filter((t) => !t.parentId && !t.doneAt && t.dueDate && t.dueDate > today).sort(byTime);

export function subjectAverages(subjects: Subject[], grades: Grade[]) {
  return subjects.map((s) => {
    const gs = grades.filter((g) => g.subjectId === s.id);
    return { subject: s, grades: gs, avg: weightedAverage(gs), counts: s.counts !== false };
  });
}
/** Gesamtschnitt nur über Fächer, die zählen. */
export const gesamt = (rows: { avg: number | null; counts: boolean }[]) => countingAverage(rows);

export const examTone = (date: string) => (daysUntil(date) < 15 ? "soon" : "");

import { useSettings, useSettingsQuery, useTransactions, useToday as useTodayQ, useHealth } from "./queries";
import { budgetOf, monthSummary } from "../shared/geld";

/** Übrig im laufenden Monat: Budget (Lohn minus Einzahlung) minus eigener Anteil der Ausgaben. */
export function useMonthMoney() {
  const today = useTodayQ();
  const month = today.slice(0, 7);
  const q = useTransactions(month);
  const s = useSettings();
  const settings = useSettingsQuery();
  const budget = budgetOf(s.salary, s.investMonthly);
  return { month, txs: q.data ?? [], loaded: q.isSuccess && settings.isSuccess, loading: q.isPending || settings.isPending, error: q.error ?? settings.error, budget, summary: monthSummary(q.data ?? [], budget) };
}

export function useLatest(metric: "sleepMin" | "steps" | "restingHr" | "weightKg") {
  const h = useHealth(90);
  const rows = h.rows.filter((r) => r[metric] !== null && (metric !== "steps" || r.day === h.to)).sort((a, b) => a.day.localeCompare(b.day));
  return { latest: rows.at(-1) ?? null, rows: h.rows, loaded: h.loaded, loading: h.loading, error: h.error };
}
