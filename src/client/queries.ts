// Datenzugriff mit sofortiger Reaktion: Änderungen erscheinen zuerst lokal und werden bei Fehlern zurückgerollt.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "./api";
import { notify } from "./toast";
import { errorMessage } from "./query-state";
import { addDays, mondayOf, todayInZone } from "../shared/dates";
import { visibleEvents } from "../shared/agenda";
import { blocksOn, type LessonBlock } from "../shared/stundenplan";
import { SETTING_DEFAULTS } from "../shared/settings";
import type * as S from "../shared/schemas";

export const keys = {
  tasks: ["tasks"] as const,
  projects: ["projects"] as const,
  settings: ["settings"] as const,
  subjects: ["subjects"] as const,
  exams: ["exams"] as const,
  exam: (id: string) => ["exam", id] as const,
  grades: ["grades"] as const,
  plans: ["gym-plans"] as const,
  gymDays: (from: string) => ["gym-days", from] as const,
  gymDay: (day: string) => ["gym-day", day] as const,
  gymHistory: ["gym-history"] as const,
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  tx: (m: string) => ["tx", m] as const,
  invest: ["invest"] as const,
  depotBuys: ["depot-buys"] as const,
  health: (from: string, to: string) => ["health", from, to] as const,
  calendars: ["calendars"] as const,
  events: (from: string, to: string) => ["events", from, to] as const,
  lastSync: ["last-sync"] as const,
  pushStatus: ["push-status"] as const,
  timetable: ["timetable"] as const,
};

/** Aktuelle Zeit, minütlich aktualisiert (für Tag, Balken und Countdown). */
export function useNow(): Date {
  const [n, setN] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setN(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return n;
}
export const useToday = () => todayInZone(useNow());

/**
 * Optimistische Änderung: `apply` verändert den Zwischenspeicher sofort, bei Fehler wird zurückgerollt
 * und eine kurze Meldung gezeigt. Danach wird neu geladen.
 */
function useOpt<V, D>(o: { key: QueryKey | ((v: V) => QueryKey); fn: (v: V) => Promise<unknown>; apply?: (d: D, v: V) => D; also?: QueryKey[]; after?: (r: unknown, v: V) => void }) {
  const qc = useQueryClient();
  const keyOf = (v: V) => (typeof o.key === "function" ? o.key(v) : o.key);
  return useMutation({
    mutationFn: o.fn,
    onMutate: async (v: V) => {
      const key = keyOf(v);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<D>(key);
      if (o.apply && prev !== undefined) qc.setQueryData<D>(key, o.apply(prev, v));
      return { prev, key };
    },
    onError: (error, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev);
      notify(`Nicht gespeichert. ${errorMessage(error)}`);
    },
    onSuccess: (r, v) => o.after?.(r, v),
    onSettled: (_r, _e, v) => {
      qc.invalidateQueries({ queryKey: keyOf(v) });
      o.also?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

/* ---------- Aufgaben ---------- */
export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: api.tasks.list });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects.list });

const mkTask = (b: S.TaskCreate & { id: string }): S.Task => {
  const now = new Date().toISOString();
  return {
    id: b.id, title: b.title, notes: b.notes ?? null, projectId: b.projectId ?? null, parentId: b.parentId ?? null,
    dueDate: b.dueDate ?? null, dueTime: b.dueTime ?? null, priority: b.priority ?? 4, recurrence: b.recurrence ?? null,
    durationMin: b.durationMin ?? null, examId: b.examId ?? null, doneAt: null, sortOrder: b.sortOrder ?? 0, createdAt: now, updatedAt: now,
  };
};

export function useCreateTask() {
  return useOpt<S.TaskCreate & { id: string }, S.Task[]>({ key: keys.tasks, fn: (b) => api.tasks.create(b), apply: (d, b) => [...d, mkTask(b)] });
}
export function useUpdateTask() {
  return useOpt<{ id: string; patch: S.TaskUpdate }, S.Task[]>({
    key: keys.tasks,
    fn: ({ id, patch }) => api.tasks.update(id, patch),
    apply: (d, { id, patch }) =>
      d.map((t) => {
        if (t.id !== id) return t;
        const { done, actualMin: _a, ...rest } = patch;
        const next = { ...t, ...rest } as S.Task;
        if (done !== undefined) next.doneAt = done ? (t.doneAt ?? new Date().toISOString()) : null;
        return next;
      }),
  });
}
export const useToggleTask = () => {
  const u = useUpdateTask();
  return { ...u, mutate: (id: string, done: boolean, options?: Parameters<typeof u.mutate>[1]) => u.mutate({ id, patch: { done } }, options) };
};
export function useDeleteTask() {
  return useOpt<string, S.Task[]>({ key: keys.tasks, fn: (id) => api.tasks.remove(id), apply: (d, id) => d.filter((t) => t.id !== id && t.parentId !== id) });
}
export function useCreateProject() {
  return useOpt<{ id: string; name: string }, S.Project[]>({
    key: keys.projects,
    fn: (b) => api.projects.create(b),
    apply: (d, b) => [...d, { id: b.id, name: b.name, sortOrder: d.length, archived: false, createdAt: "", updatedAt: "" }],
  });
}

/* ---------- Einstellungen ---------- */
export const useSettingsQuery = () => useQuery({ queryKey: keys.settings, queryFn: api.settings.get });
export function useSettings(): S.Settings {
  const q = useSettingsQuery();
  return q.data ?? SETTING_DEFAULTS;
}
export function useSetSetting() {
  const m = useOpt<S.SettingsUpdate, S.Settings>({ key: keys.settings, fn: (b) => api.settings.put(b), apply: (d, b) => ({ ...d, ...b }) as S.Settings });
  return (b: S.SettingsUpdate) => m.mutate(b);
}

/* ---------- Schule ---------- */
export const useSubjects = () => useQuery({ queryKey: keys.subjects, queryFn: api.subjects.list });
export function useSetSubjectCounts() {
  return useOpt<{ id: string; counts: boolean }, S.Subject[]>({
    key: keys.subjects,
    fn: ({ id, counts }) => api.subjects.update(id, { counts }),
    apply: (d, { id, counts }) => d.map((x) => (x.id === id ? { ...x, counts } : x)),
  });
}
export const useExams = () => useQuery({ queryKey: keys.exams, queryFn: () => api.exams.list(todayInZone()) });
export const useExam = (id: string) => useQuery({ queryKey: keys.exam(id), queryFn: () => api.exams.get(id) });
export const useGrades = () => useQuery({ queryKey: keys.grades, queryFn: api.grades.list });

export function useSetAssessment(examId: string) {
  return useOpt<{ topicId: string; assessment: S.Assessment }, S.ExamDetail>({
    key: keys.exam(examId),
    fn: ({ topicId, assessment }) => api.topics.update(topicId, { assessment }),
    apply: (d, { topicId, assessment }) => {
      const topics = d.topics.map((t) => (t.id === topicId ? { ...t, assessment } : t));
      return { ...d, topics, topicsSolid: topics.filter((t) => t.assessment === 2).length };
    },
    also: [keys.exams],
  });
}
export function useSetTopicNotes(examId: string) {
  return useOpt<{ topicId: string; notes: string | null }, S.ExamDetail>({
    key: keys.exam(examId),
    fn: ({ topicId, notes }) => api.topics.update(topicId, { notes }),
    apply: (d, { topicId, notes }) => ({ ...d, topics: d.topics.map((t) => (t.id === topicId ? { ...t, notes } : t)) }),
  });
}
export function useAddTopic(examId: string) {
  return useOpt<{ id: string; title: string }, S.ExamDetail>({
    key: keys.exam(examId),
    fn: (b) => api.exams.addTopic(examId, b),
    apply: (d, b) => ({
      ...d,
      topicCount: d.topicCount + 1,
      topics: [...d.topics, { id: b.id, examId, title: b.title, assessment: 0, notes: null, summary: null, sortOrder: d.topics.length, createdAt: "", updatedAt: "" }],
    }),
    also: [keys.exams],
  });
}
export function usePlanStudy(examId: string) {
  return useOpt<boolean, S.Task[]>({ key: keys.tasks, fn: (replace) => api.exams.plan(examId, replace) });
}
export function useAddGrade() {
  return useOpt<S.GradeCreate & { id: string }, S.Grade[]>({
    key: keys.grades,
    fn: (b) => api.grades.create(b),
    apply: (d, b) => [
      { id: b.id, subjectId: b.subjectId!, title: b.title ?? null, value: b.value, weight: b.weight ?? 1, date: b.date, source: "manuell", isNew: false, createdAt: new Date().toISOString(), updatedAt: "" },
      ...d,
    ],
  });
}
export function useDeleteGrade() {
  return useOpt<string, S.Grade[]>({ key: keys.grades, fn: (id) => api.grades.remove(id), apply: (d, id) => d.filter((g) => g.id !== id) });
}

/* ---------- Gym ---------- */
export const useGymPlans = () => useQuery({ queryKey: keys.plans, queryFn: api.gym.plans });
export const useGymHistory = () => useQuery({ queryKey: keys.gymHistory, queryFn: api.gym.history });
export const useGymDay = (day: string) => useQuery({ queryKey: keys.gymDay(day), queryFn: () => api.gym.day(day) });
export function useGymDays(weeks = 16) {
  const today = useToday();
  const from = addDays(mondayOf(today), -(weeks - 1) * 7);
  const q = useQuery({ queryKey: keys.gymDays(from), queryFn: () => api.gym.days(from, addDays(today, 1)) });
  return { from, done: new Set((q.data ?? []).filter((d) => d.finished).map((d) => d.day)), loaded: q.isSuccess, loading: q.isPending, error: q.error };
}
export function useSavePlan() {
  return useOpt<{ id?: string; plan: S.GymPlanWrite }, S.GymPlan[]>({
    key: keys.plans,
    fn: ({ id, plan }) => (id ? api.gym.savePlan(id, plan) : api.gym.createPlan(plan)),
    apply: (d, { id, plan }) => {
      const pid = id ?? plan.id ?? "neu";
      const full: S.GymPlan = {
        id: pid, name: plan.name, weekdays: [...plan.weekdays].sort((a, b) => a - b), sortOrder: d.length,
        exercises: plan.exercises.map((e, i) => ({ id: e.id ?? `n${i}`, planId: pid, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight ?? null, sortOrder: i })),
      };
      return id ? d.map((p) => (p.id === id ? full : p)) : [...d, full];
    },
    also: [["gym-day"]],
  });
}
export function useDeletePlan() {
  return useOpt<string, S.GymPlan[]>({ key: keys.plans, fn: (id) => api.gym.deletePlan(id), apply: (d, id) => d.filter((p) => p.id !== id), also: [["gym-day"]] });
}
export function useStartSession(day: string) {
  return useOpt<void, S.GymDay>({ key: keys.gymDay(day), fn: () => api.gym.startSession(day), also: [["gym-days"]] });
}
export function useFinishSession(day: string) {
  return useOpt<boolean, S.GymDay>({
    key: keys.gymDay(day),
    fn: (f) => api.gym.finish(day, f),
    apply: (d, f) => ({ ...d, session: d.session ? { ...d.session, finishedAt: f ? new Date().toISOString() : null } : { id: "neu", day, planId: null, planName: null, finishedAt: f ? new Date().toISOString() : null, sets: [] } }),
    also: [["gym-days"]],
  });
}
export function useRemoveSession(day: string) {
  return useOpt<void, S.GymDay>({ key: keys.gymDay(day), fn: () => api.gym.removeSession(day), apply: (d) => ({ ...d, session: null }), also: [["gym-days"]] });
}
export function useUpdateSet(day: string) {
  const qc = useQueryClient();
  return useOpt<{ id: string; patch: { done?: boolean; weight?: number | null; reps?: number } }, S.GymDay>({
    key: keys.gymDay(day),
    fn: ({ id, patch }) => api.gym.updateSet(id, patch),
    apply: (d, { id, patch }) => (d.session ? { ...d, session: { ...d.session, sets: d.session.sets.map((s) => (s.id === id ? { ...s, ...patch } : s)) } } : d),
    after: () => void qc.invalidateQueries({ queryKey: keys.gymHistory }),
  });
}

/* ---------- Geld ---------- */
export const useAccounts = () => useQuery({ queryKey: keys.accounts, queryFn: api.money.accounts });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: api.money.categories });
export const useTransactions = (month: string) => useQuery({ queryKey: keys.tx(month), queryFn: () => api.money.transactions(month) });
export const useAllTransactions = () => useQuery({ queryKey: keys.tx("all"), queryFn: () => api.money.transactions() });
export const useInvest = () => useQuery({ queryKey: keys.invest, queryFn: api.money.invest });
export const useDepotBuys = () => useQuery({ queryKey: keys.depotBuys, queryFn: api.money.depotBuys });
export function useAddInvest() {
  return useOpt<S.InvestmentEntryCreate & { id: string }, S.InvestmentEntry[]>({
    key: keys.invest,
    also: [keys.depotBuys],
    fn: (b) => api.money.addInvest(b),
    apply: (d, b) => [...d.filter((e) => !(b.kind === "value" && e.kind === "value" && e.date === b.date && (e.estimated || e.note === "auto"))), { id: b.id, kind: b.kind, date: b.date, amount: b.amount, note: b.note ?? null, estimated: false }].sort((a, c) => a.date.localeCompare(c.date)),
  });
}
export function useRemoveInvest() {
  return useOpt<string, S.InvestmentEntry[]>({ key: keys.invest, also: [keys.depotBuys], fn: (id) => api.money.removeInvest(id), apply: (d, id) => d.filter((e) => e.id !== id) });
}
export function useUpdateTx() {
  return useOpt<{ id: string; patch: Record<string, unknown> }, S.Transaction[]>({
    key: keys.tx("all"),
    fn: ({ id, patch }) => api.money.updateTx(id, patch),
    apply: (d, { id, patch }) =>
      d.map((t) => {
        if (t.id !== id) return t;
        const { settled, ...rest } = patch as { settled?: boolean };
        return { ...t, ...rest, ...(settled === undefined ? {} : { settledAt: settled ? new Date().toISOString() : null }) } as S.Transaction;
      }),
    also: [["tx"]],
  });
}

/* ---------- Körper ---------- */
export function useHealth(days: number) {
  const to = useToday();
  const from = addDays(to, -(days - 1));
  const q = useQuery({ queryKey: keys.health(from, to), queryFn: () => api.health.list(from, to) });
  return { from, to, rows: q.data ?? [], loaded: q.isSuccess, loading: q.isPending, error: q.error };
}
export function usePutHealth() {
  const qc = useQueryClient();
  return useOpt<{ day: string; patch: S.HealthUpsert }, S.HealthDay[]>({
    key: ["health"],
    fn: ({ day, patch }) => api.health.put(day, patch),
    after: () => void qc.invalidateQueries({ queryKey: ["health"] }),
  });
}

/* ---------- Kalender (nur lesen) ---------- */
export const useCalendars = () => useQuery({ queryKey: keys.calendars, queryFn: api.calendar.list });
export const useLastSync = () => useQuery({ queryKey: keys.lastSync, queryFn: api.calendar.lastRun });

/** Termine eines Zeitraums, schon ohne ausgeblendete Hausaufgaben und ohne Prüfungs-Dubletten. */
export function useEvents(from: string, to: string) {
  const q = useQuery({ queryKey: keys.events(from, to), queryFn: () => api.calendar.events(from, to) });
  const exams = useExams().data;
  const subjects = useSubjects().data;
  const hide = useSettings().hideHomework !== "0";
  const events = useMemo(() => {
    const names = new Map((subjects ?? []).map((s) => [s.code, s.name ?? null]));
    return visibleEvents(q.data ?? [], { hideHomework: hide, exams: (exams ?? []).map((e) => ({ date: e.date, subjectCode: e.subjectCode, subjectName: names.get(e.subjectCode) ?? null })) });
  }, [q.data, exams, subjects, hide]);
  return { events, loaded: q.isSuccess, loading: q.isPending, error: q.error };
}

/** Stundenplan: `has` sagt, ob überhaupt einer da ist; `on(day)` liefert die Lektionsblöcke eines Tages (ohne Schulferien). */
export function useTimetable() {
  const q = useQuery({ queryKey: keys.timetable, queryFn: api.timetable.get, staleTime: 10 * 60_000 });
  const until = useSettings().schoolHolidayUntil;
  const lessons = q.data?.lessons;
  return useMemo(() => {
    const list = lessons ?? [];
    return { loaded: q.isSuccess, loading: q.isPending, error: q.error, has: list.length > 0, holidayUntil: until, on: (day: string): LessonBlock[] => blocksOn(list, day, until || null) };
  }, [lessons, until, q.isSuccess, q.isPending, q.error]);
}

export function useAddCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: S.CalendarCreate) => api.calendar.create(b),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.calendars }),
  });
}
export function useRemoveCalendar() {
  return useOpt<string, S.CalendarInfo[]>({ key: keys.calendars, fn: (id) => api.calendar.remove(id), apply: (d, id) => d.filter((c) => c.id !== id), also: [["events"]] });
}
export function useSyncCalendars() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.calendar.sync,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      void qc.invalidateQueries({ queryKey: keys.lastSync });
    },
  });
}
