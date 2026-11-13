// Datenzugriff mit sofortiger Reaktion: Änderungen erscheinen zuerst lokal und werden bei Fehlern zurückgerollt.
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "./api";
import { todayInZone } from "../shared/dates";
import type { Assessment, Exam, ExamDetail, ExamStatus, Task, TaskCreate } from "../shared/schemas";

export const keys = {
  tasks: ["tasks"] as const,
  taskList: (view: "all" | "today") => ["tasks", view] as const,
  exams: ["exams"] as const,
  exam: (id: string) => ["exam", id] as const,
  grades: ["grades"] as const,
  syncRuns: (kind: string) => ["sync-runs", kind] as const,
};

export const useTasks = (view: "all" | "today") => useQuery({ queryKey: keys.taskList(view), queryFn: () => api.tasks.list({ view }) });
export const useExams = () => useQuery({ queryKey: keys.exams, queryFn: () => api.exams.list(todayInZone()) });
export const useExam = (id: string) => useQuery({ queryKey: keys.exam(id), queryFn: () => api.exams.get(id) });
export const useGrades = () => useQuery({ queryKey: keys.grades, queryFn: api.grades.list });
export const useLastSync = (kind: string) => useQuery({ queryKey: keys.syncRuns(kind), queryFn: () => api.syncRuns.list(kind) });

type Snapshot = [QueryKey, unknown][];

function restore(qc: ReturnType<typeof useQueryClient>, snap: Snapshot | undefined) {
  snap?.forEach(([k, d]) => qc.setQueryData(k, d));
}

export function useToggleTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.tasks.update(id, { done }),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: keys.tasks });
      const snap = qc.getQueriesData({ queryKey: keys.tasks });
      qc.setQueriesData<Task[]>({ queryKey: keys.tasks }, (list) =>
        list?.map((t) => (t.id === id ? { ...t, doneAt: done ? (t.doneAt ?? new Date().toISOString()) : null } : t)),
      );
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    // Kein sofortiges Neuladen: erledigte Aufgaben bleiben bis zum nächsten Abruf durchgestrichen stehen.
    onSuccess: (task) => qc.setQueriesData<Task[]>({ queryKey: keys.tasks }, (list) => list?.map((t) => (t.id === task.id ? task : t))),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TaskCreate & { id: string }) => api.tasks.create(b),
    onMutate: async (b) => {
      await qc.cancelQueries({ queryKey: keys.tasks });
      const snap = qc.getQueriesData({ queryKey: keys.tasks });
      const now = new Date().toISOString();
      const optimistic: Task = {
        id: b.id,
        title: b.title,
        notes: b.notes ?? null,
        projectId: b.projectId ?? null,
        parentId: b.parentId ?? null,
        dueDate: b.dueDate ?? null,
        dueTime: b.dueTime ?? null,
        priority: b.priority ?? 4,
        recurrence: b.recurrence ?? null,
        durationMin: b.durationMin ?? null,
        examId: b.examId ?? null,
        doneAt: null,
        sortOrder: b.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<Task[]>(keys.taskList("all"), (l) => (l ? [...l, optimistic] : l));
      if (optimistic.dueDate && optimistic.dueDate <= todayInZone()) {
        qc.setQueryData<Task[]>(keys.taskList("today"), (l) => (l ? [...l, optimistic] : l));
      }
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tasks }),
  });
}

export function useSetAssessment(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ topicId, assessment }: { topicId: string; assessment: Assessment }) => api.topics.update(topicId, { assessment }),
    onMutate: async ({ topicId, assessment }) => {
      await qc.cancelQueries({ queryKey: keys.exam(examId) });
      const prev = qc.getQueryData<ExamDetail>(keys.exam(examId));
      if (prev) {
        const topics = prev.topics.map((t) => (t.id === topicId ? { ...t, assessment } : t));
        qc.setQueryData<ExamDetail>(keys.exam(examId), { ...prev, topics, topicsSolid: topics.filter((t) => t.assessment === 2).length });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.exam(examId), ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.exams }),
  });
}

export function useSetExamStatus(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: ExamStatus) => api.exams.update(examId, { status }),
    onMutate: async (status) => {
      await qc.cancelQueries({ queryKey: keys.exam(examId) });
      await qc.cancelQueries({ queryKey: keys.exams });
      const prev = qc.getQueryData<ExamDetail>(keys.exam(examId));
      const prevList = qc.getQueryData<Exam[]>(keys.exams);
      if (prev) qc.setQueryData<ExamDetail>(keys.exam(examId), { ...prev, status });
      qc.setQueryData<Exam[]>(keys.exams, (l) => l?.map((e) => (e.id === examId ? { ...e, status } : e)));
      return { prev, prevList };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.exam(examId), ctx.prev);
      if (ctx?.prevList) qc.setQueryData(keys.exams, ctx.prevList);
    },
    onSuccess: (exam) => qc.setQueryData(keys.exam(examId), exam),
  });
}
