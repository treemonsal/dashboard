// Dünne Hülle um die eigene API. Typen kommen aus src/shared.
import type * as S from "../shared/schemas";

export interface PdfFileIn {
  bank: "revolut" | "zkb" | "yuh" | "unbekannt";
  account?: string;
  uncertain: number;
  confirmed: boolean;
  rows: { date: string; description: string; amount: number; currency: string; amountChf: number; balance?: number; chfEstimated?: boolean }[];
}
export interface ImportFileIn {
  name: string;
  text: string;
  mapping?: NonNullable<S.ImportFilePreview["mapping"]>;
  /** PDF: im Browser gelesene Buchungen */
  pdf?: PdfFileIn;
  /** Nur Oberfläche, geht nicht an den Server */
  pdfInfo?: { warnings: string[]; dated: number; recognized: number; text: string };
}
const wire = (files: ImportFileIn[]) => files.map(({ name, text, mapping, pdf }) => ({ name, text, ...(mapping ? { mapping } : {}), ...(pdf ? { pdf } : {}) }));

export interface ConnectorGrant {
  id: string;
  clientId: string;
  clientName: string | null;
  scope: string[];
  redirectUri: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface IntakeStatus { active: boolean; createdAt: string | null; lastAt: string | null; locked: boolean }
export const intake = {
  status: () => request<IntakeStatus>("GET", "/eingang"),
  newKey: () => request<{ key: string }>("POST", "/eingang/schluessel", {}),
  revoke: () => request<{ ok: true }>("DELETE", "/eingang/schluessel"),
  test: () => request<{ ok: boolean; account?: string; reason?: string }>("POST", "/eingang/test", {}),
};

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
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new ApiError(401, "Bitte erneut anmelden.");
  }
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
  subjects: { list: () => get<S.Subject[]>("/subjects"), update: (id: string, b: S.SubjectUpdate) => patch<S.Subject>(`/subjects/${id}`, b) },
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
    historyAll: () => get<Record<string, S.GymHistoryPoint[]>>("/gym/history?all=1"),
  },
  money: {
    accounts: () => get<S.Account[]>("/accounts"),
    categories: () => get<S.Category[]>("/categories"),
    transactions: (month?: string) => get<S.Transaction[]>(`/transactions?limit=1000${month ? `&month=${month}` : ""}`),
    updateTx: (id: string, b: Record<string, unknown>) => patch<S.Transaction>(`/transactions/${id}`, b),
    addProvisional: (b: { accountId: string; categoryId?: string | null; date: string; amount: number; merchant: string }) => post<{ id: string }>("/provisional", b),
    removeTx: (id: string) => del(`/transactions/${id}`),
    setBalance: (id: string, balance: number) => put<unknown>(`/accounts/${id}/balance`, { balance }),
    bookUnrecorded: (id: string) => post<{ id: string }>(`/accounts/${id}/unrecorded`, {}),
    invest: () => get<S.InvestmentEntry[]>("/invest"),
    addInvest: (b: S.InvestmentEntryCreate) => post<S.InvestmentEntry>("/invest", b),
    removeInvest: (id: string) => del(`/invest/${id}`),
    depotKurse: () => get<{ symbol: string; close: number | null; date: string | null; fx: number | null }[]>("/depot/kurse"),
    depotRefresh: () => post<{ ok: boolean; message: string; added: number }>("/depot/refresh", {}),
  },
  health: {
    syncIfStale: () => post<{ ran: boolean; ok?: boolean }>("/fitbit/sync-if-stale", {}),
    list: (from: string, to: string) => get<S.HealthDay[]>(`/health?from=${from}&to=${to}`),
    put: (day: string, b: S.HealthUpsert) => put<S.HealthDay>(`/health/${day}`, b),
  },
  bank: {
    preview: (files: ImportFileIn[]) => post<S.ImportPreview>("/import/preview", { files: wire(files) }),
    commit: (files: ImportFileIn[]) => post<S.ImportResult>("/import/commit", { files: wire(files) }),
  },
  timetable: { get: () => get<{ lessons: S.TimetableLesson[] }>("/timetable") },
  calendar: {
    list: () => get<S.CalendarInfo[]>("/calendars"),
    create: (b: S.CalendarCreate) => post<S.CalendarInfo>("/calendars", b),
    remove: (id: string) => del(`/calendars/${id}`),
    sync: () => post<S.CalendarSyncResult>("/calendar/sync"),
    events: (from: string, to: string) => get<S.CalendarEvent[]>(`/calendar/events?from=${from}&to=${to}`),
    lastRun: () => get<S.SyncRun[]>("/sync-runs?kind=kalender&limit=1"),
  },
  push: {
    status: () => get<{ count: number; configured: boolean }>("/push/status"),
    subscribe: (sub: PushSubscriptionJSON) => post<{ ok: true }>("/push/subscribe", sub),
    unsubscribe: (endpoint: string) => post<{ ok: true }>("/push/unsubscribe", { endpoint }),
    test: () => post<S.PushResult>("/push/test"),
  },
  connector: {
    grants: () => get<ConnectorGrant[]>("/connector/grants"),
    revoke: (id: string) => del(`/connector/grants/${encodeURIComponent(id)}`),
  },
  taskEvents: () => get<S.TaskEvent[]>("/task-events"),
  syncRuns: (limit = 30) => get<S.SyncRun[]>(`/sync-runs?limit=${limit}`),
  exportAll: () => get<unknown>("/export"),
};
