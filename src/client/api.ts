// Dünne Hülle um die eigene API. Typen kommen aus src/shared.
import type {
  Exam,
  ExamDetail,
  ExamTopic,
  ExamTopicUpdate,
  ExamUpdate,
  Grade,
  SyncRun,
  Task,
  TaskCreate,
  TaskUpdate,
} from "../shared/schemas";

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

export const api = {
  tasks: {
    list: (q: { view?: "all" | "today"; examId?: string } = {}) => request<Task[]>("GET", `/tasks?${new URLSearchParams(q as Record<string, string>)}`),
    create: (b: TaskCreate) => request<Task>("POST", "/tasks", b),
    update: (id: string, b: TaskUpdate) => request<Task>("PATCH", `/tasks/${id}`, b),
  },
  exams: {
    list: (from?: string) => request<Exam[]>("GET", from ? `/exams?from=${from}` : "/exams"),
    get: (id: string) => request<ExamDetail>("GET", `/exams/${id}`),
    update: (id: string, b: ExamUpdate) => request<ExamDetail>("PATCH", `/exams/${id}`, b),
  },
  topics: {
    update: (id: string, b: ExamTopicUpdate) => request<ExamTopic>("PATCH", `/exam-topics/${id}`, b),
  },
  grades: {
    list: () => request<Grade[]>("GET", "/grades"),
  },
  syncRuns: {
    list: (kind: string) => request<SyncRun[]>("GET", `/sync-runs?kind=${encodeURIComponent(kind)}&limit=1`),
  },
};
