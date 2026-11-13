// Dünne Hülle um die eigene API. Typen kommen aus src/shared.
import type * as S from "../shared/schemas";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Fehler ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* keine JSON-Antwort, z.B. Login-Seite */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}
const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b: unknown = {}) => request<T>("POST", p, b);
const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
const put = <T>(p: string, b: unknown) => request<T>("PUT", p, b);
const del = (p: string) => request<{ ok: true }>("DELETE", p);

export const api = {
  tasks: {
    list: () => get<S.Task[]>("/tasks?view=all"),
    create: (b: S.TaskCreate) => post<S.Task>("/tasks", b),
    update: (id: string, b: S.TaskUpdate) => patch<S.Task>(`/tasks/${id}`, b),
    remove: (id: string) => del(`/tasks/${id}`),
  },
  projects: {
    list: () => get<S.Project[]>("/projects"),
    create: (b: S.ProjectCreate) => post<S.Project>("/projects", b),
  },
  settings: {
    get: () => get<S.Settings>("/settings"),
    put: (b: S.SettingsUpdate) => put<S.Settings>("/settings", b),
  },
  subjects: { list: () => get<S.Subject[]>("/subjects") },
  exams: {
    list: (from?: string) => get<S.Exam[]>(from ? `/exams?from=${from}` : "/exams"),
    get: (id: string) => get<S.ExamDetail>(`/exams/${id}`),
    update: (id: string, b: S.ExamUpdate) => patch<S.ExamDetail>(`/exams/${id}`, b),
    addTopic: (id: string, b: S.ExamTopicCreate) => post<S.ExamTopic>(`/exams/${id}/topics`, b),
    plan: (id: string, replace: boolean) => post<S.Task[]>(`/exams/${id}/study-plan`, { replace }),
  },
  topics: { update: (id: string, b: S.ExamTopicUpdate) => patch<S.ExamTopic>(`/exam-topics/${id}`, b) },
  grades: {
    list: () => get<S.Grade[]>("/grades"),
    create: (b: S.GradeCreate) => post<S.Grade>("/grades", b),
    remove: (id: string) => del(`/grades/${id}`),
  },
  gym: {
    plans: () => get<S.GymPlan[]>("/gym/plans"),
    createPlan: (b: S.GymPlanWrite) => post<S.GymPlan>("/gym/plans", b),
    savePlan: (id: string, b: S.GymPlanWrite) => put<S.GymPlan>(`/gym/plans/${id}`, b),
    deletePlan: (id: string) => del(`/gym/plans/${id}`),
    days: (from: string, to: string) => get<{ day: string; finished: boolean }[]>(`/gym/days?from=${from}&to=${to}`),
    day: (day: string) => get<S.GymDay>(`/gym/day/${day}`),
    startSession: (day: string) => post<S.GymSession>(`/gym/sessions/${day}`, {}),
    finish: (day: string, finished: boolean) => patch<S.GymSession>(`/gym/sessions/${day}`, { finished }),
    removeSession: (day: string) => del(`/gym/sessions/${day}`),
    updateSet: (id: string, b: { done?: boolean; weight?: number | null; reps?: number }) => patch<S.GymSet>(`/gym/sets/${id}`, b),
    history: () => get<Record<string, S.GymHistoryPoint[]>>("/gym/history"),
  },
  money: {
    accounts: () => get<S.Account[]>("/accounts"),
    categories: () => get<S.Category[]>("/categories"),
    transactions: (month?: string) => get<S.Transaction[]>(`/transactions?limit=1000${month ? `&month=${month}` : ""}`),
    updateTx: (id: string, b: Record<string, unknown>) => patch<S.Transaction>(`/transactions/${id}`, b),
    invest: () => get<S.InvestmentEntry[]>("/invest"),
    addInvest: (b: S.InvestmentEntryCreate) => post<S.InvestmentEntry>("/invest", b),
    removeInvest: (id: string) => del(`/invest/${id}`),
  },
  health: {
    list: (from: string, to: string) => get<S.HealthDay[]>(`/health?from=${from}&to=${to}`),
    put: (day: string, b: S.HealthUpsert) => put<S.HealthDay>(`/health/${day}`, b),
  },
  exportAll: () => get<unknown>("/export"),
};
