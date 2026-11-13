import { describe, expect, it, beforeAll } from "vitest";
import { exports } from "cloudflare:workers";
import type { Exam, ExamDetail, ExamTopic, Goal, Grade, Habit, HabitLog, Task } from "../src/shared/schemas";
import { todayInZone } from "../src/shared/dates";

const base = "http://localhost";
async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await exports.default.fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as T };
}

beforeAll(async () => {
  await call("POST", "/api/subjects", { id: "s-wr", code: "W+R" });
  await call("POST", "/api/subjects", { id: "s-e", code: "E" });
});

describe("Aufgaben", () => {
  it("legt an, liest und ändert", async () => {
    const created = await call<Task>("POST", "/api/tasks", { title: "FRW repetieren", dueDate: todayInZone(), priority: 2, durationMin: 45 });
    expect(created.status).toBe(201);
    expect(created.data.doneAt).toBeNull();
    const id = created.data.id;

    const done = await call<Task>("PATCH", `/api/tasks/${id}`, { done: true });
    expect(done.status).toBe(200);
    expect(done.data.doneAt).not.toBeNull();

    const today = await call<Task[]>("GET", "/api/tasks?view=today");
    expect(today.data.map((t) => t.id)).toContain(id);

    const undone = await call<Task>("PATCH", `/api/tasks/${id}`, { done: false, title: "FRW Kapitel 11" });
    expect(undone.data.doneAt).toBeNull();
    expect(undone.data.title).toBe("FRW Kapitel 11");
  });

  it("nimmt eine vom Client vergebene ID an (für optimistische Updates)", async () => {
    const r = await call<Task>("POST", "/api/tasks", { id: "client-abc", title: "X" });
    expect(r.data.id).toBe("client-abc");
  });

  it("speichert Unteraufgaben und Wiederholung", async () => {
    const parent = await call<Task>("POST", "/api/tasks", { title: "Bank-Exporte", recurrence: "FREQ=MONTHLY;BYMONTHDAY=1" });
    expect(parent.data.recurrence).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    const child = await call<Task>("POST", "/api/tasks", { title: "ZKB", parentId: parent.data.id });
    expect(child.status).toBe(201);
    const list = await call<Task[]>("GET", `/api/tasks?parentId=${parent.data.id}`);
    expect(list.data).toHaveLength(1);
  });

  it("weist ungültige Eingaben ab", async () => {
    expect((await call("POST", "/api/tasks", { title: "" })).status).toBe(400);
    expect((await call("POST", "/api/tasks", { title: "a", dueDate: "13.11.2026" })).status).toBe(400);
    expect((await call("POST", "/api/tasks", { title: "a", priority: 7 })).status).toBe(400);
    expect((await call("POST", "/api/tasks", { title: "a", recurrence: "jeden Tag" })).status).toBe(400);
    expect((await call("POST", "/api/tasks", { title: "a", parentId: "gibt-es-nicht" })).status).toBe(400);
    expect((await call("PATCH", "/api/tasks/gibt-es-nicht", { title: "b" })).status).toBe(404);
  });
});

describe("Prüfungen und Themen", () => {
  it("legt eine Prüfung mit Themen an und ändert Status und Einschätzung", async () => {
    const r = await call<ExamDetail>("POST", "/api/exams", {
      subjectCode: "E",
      title: "CAE/CPE listening",
      date: "2026-12-11",
      startTime: "06:30",
      endTime: "08:05",
      room: "LI121",
      hint: "Uhrzeit prüfen",
      topics: ["CAE/CPE listening"],
    });
    expect(r.status).toBe(201);
    expect(r.data.status).toBe("unbestaetigt");
    expect(r.data.subjectCode).toBe("E");
    expect(r.data.topics).toHaveLength(1);

    const topicId = r.data.topics[0].id;
    const t = await call<ExamTopic>("PATCH", `/api/exam-topics/${topicId}`, { assessment: 2 });
    expect(t.data.assessment).toBe(2);
    expect((await call("PATCH", `/api/exam-topics/${topicId}`, { assessment: 3 })).status).toBe(400);

    const added = await call<ExamTopic>("POST", `/api/exams/${r.data.id}/topics`, { title: "Part 2" });
    expect(added.data.sortOrder).toBe(1);

    const confirmed = await call<ExamDetail>("PATCH", `/api/exams/${r.data.id}`, { status: "bestaetigt", startTime: "08:15" });
    expect(confirmed.data.status).toBe("bestaetigt");
    expect(confirmed.data.topicCount).toBe(2);
    expect(confirmed.data.topicsSolid).toBe(1);

    const list = await call<Exam[]>("GET", "/api/exams?from=2026-12-01");
    expect(list.data.some((e) => e.id === r.data.id)).toBe(true);
    const topics = await call<ExamTopic[]>("GET", `/api/exams/${r.data.id}/topics`);
    expect(topics.data.map((x) => x.title)).toEqual(["CAE/CPE listening", "Part 2"]);
  });

  it("verlangt ein bekanntes Fach", async () => {
    expect((await call("POST", "/api/exams", { subjectCode: "XYZ", title: "a", date: "2026-12-01" })).status).toBe(400);
    expect((await call("POST", "/api/exams", { title: "a", date: "2026-12-01" })).status).toBe(400);
    expect((await call("GET", "/api/exams/gibt-es-nicht")).status).toBe(404);
  });
});

describe("Noten", () => {
  it("legt an, filtert und ändert", async () => {
    const g = await call<Grade>("POST", "/api/grades", { subjectCode: "W+R", value: 5.5, weight: 2, date: "2026-10-01", source: "Portal" });
    expect(g.status).toBe(201);
    expect(g.data.isNew).toBe(true);
    const seen = await call<Grade>("PATCH", `/api/grades/${g.data.id}`, { isNew: false });
    expect(seen.data.isNew).toBe(false);
    const list = await call<Grade[]>("GET", "/api/grades?subjectId=s-wr");
    expect(list.data).toHaveLength(1);
    expect((await call("POST", "/api/grades", { subjectCode: "W+R", value: 6.5, date: "2026-10-01" })).status).toBe(400);
  });
});

describe("Gewohnheiten und Ziele", () => {
  it("führt ein Tageslog mit Überschreiben am selben Tag", async () => {
    const h = await call<Habit>("POST", "/api/habits", { name: "Lesen", cadence: "daily", target: 20, unit: "min" });
    expect(h.status).toBe(201);
    const a = await call<HabitLog>("POST", `/api/habits/${h.data.id}/logs`, { day: "2026-11-13", value: 10 });
    const b = await call<HabitLog>("POST", `/api/habits/${h.data.id}/logs`, { day: "2026-11-13", value: 25 });
    expect(b.data.id).toBe(a.data.id);
    expect(b.data.value).toBe(25);
    const logs = await call<HabitLog[]>("GET", `/api/habits/${h.data.id}/logs?from=2026-11-01`);
    expect(logs.data).toHaveLength(1);
    expect((await call<HabitLog>("PATCH", `/api/habit-logs/${a.data.id}`, { value: 30 })).data.value).toBe(30);
    expect((await call<Habit>("PATCH", `/api/habits/${h.data.id}`, { archived: true })).data.archived).toBe(true);
    expect((await call("POST", "/api/habits", { name: "x", cadence: "stündlich" })).status).toBe(400);
  });

  it("legt Ziele an und ändert den aktuellen Wert", async () => {
    const g = await call<Goal>("POST", "/api/goals", { title: "Schnitt W+R", area: "schule", target: 5, current: 4.5, deadline: "2027-01-31" });
    expect(g.status).toBe(201);
    expect((await call<Goal>("PATCH", `/api/goals/${g.data.id}`, { current: 4.8 })).data.current).toBe(4.8);
    expect((await call<Goal[]>("GET", "/api/goals?area=schule")).data).toHaveLength(1);
  });
});

describe("Abgleiche", () => {
  it("liefert eine leere Liste ohne Läufe", async () => {
    expect((await call("GET", "/api/sync-runs?kind=schule")).data).toEqual([]);
  });
});
