import { describe, expect, it, beforeAll } from "vitest";
import { exports } from "cloudflare:workers";
import type { Account, GymDay, GymPlan, GymSession, HealthDay, InvestmentEntry, Task, Transaction } from "../src/shared/schemas";
import { addDays, todayInZone } from "../src/shared/dates";

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await exports.default.fetch("http://localhost" + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as T };
}

describe("Einstellungen", () => {
  it("liefert Standardwerte, speichert und prüft", async () => {
    const a = await call<Record<string, string>>("GET", "/api/settings");
    expect(a.data.wakeTime).toBe("06:30");
    expect(a.data.gymGoal).toBe("4");
    expect(a.data.salary).toBe("650");
    expect(a.data.mamaName).toBe("");
    const b = await call<Record<string, string>>("PUT", "/api/settings", { birthDate: "2011-05-10", schoolDays: "4,5" });
    expect(b.data.birthDate).toBe("2011-05-10");
    expect((await call("PUT", "/api/settings", { wakeTime: "6 Uhr" })).status).toBe(400);
    expect((await call("PUT", "/api/settings", { unbekannt: "x" })).status).toBe(400);
  });
});

describe("Aufgaben-Ereignisse und Löschen", () => {
  it("schreibt beim Erledigen ein Ereignis und entfernt es beim Zurücknehmen", async () => {
    await call("POST", "/api/subjects", { id: "s-x2", code: "X2" });
    const t = await call<Task>("POST", "/api/tasks", { title: "Lernen", dueDate: todayInZone(), dueTime: "18:00", durationMin: 30 });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true, actualMin: 25 });
    let ev = await call<{ title: string; durationMin: number; plannedTime: string; weekday: number }[]>("GET", "/api/task-events");
    const mine = ev.data.filter((e) => e.title === "Lernen");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ durationMin: 25, plannedTime: "18:00" });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: false });
    ev = await call("GET", "/api/task-events");
    expect(ev.data.filter((e) => e.title === "Lernen")).toHaveLength(0);
    expect((await call("DELETE", `/api/tasks/${t.data.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/tasks/${t.data.id}`)).status).toBe(404);
  });
});

describe("Lernplan", () => {
  it("legt Aufgaben mit exam_id an und ersetzt offene beim Neuplanen", async () => {
    const exam = await call<{ id: string }>("POST", "/api/exams", { subjectCode: "X2", title: "Test", date: addDays(todayInZone(), 10), topics: ["A", "B"] });
    const r = await call<Task[]>("POST", `/api/exams/${exam.data.id}/study-plan`, {});
    expect(r.status).toBe(201);
    expect(r.data).toHaveLength(4);
    expect(r.data.every((x) => x.examId === exam.data.id)).toBe(true);
    const again = await call<Task[]>("POST", `/api/exams/${exam.data.id}/study-plan`, { replace: true });
    expect(again.data).toHaveLength(4);
    const all = await call<Task[]>("GET", `/api/tasks?examId=${exam.data.id}`);
    expect(all.data).toHaveLength(4);
    expect((await call("POST", "/api/exams/gibt-es-nicht/study-plan", {})).status).toBe(404);
  });
});

describe("Gym", () => {
  let plan: GymPlan;
  beforeAll(async () => {
    const wd = new Date(todayInZone() + "T00:00:00Z").getUTCDay();
    const r = await call<GymPlan>("POST", "/api/gym/plans", {
      name: "Test",
      weekdays: [wd],
      exercises: [{ name: "Bankdrücken", sets: 3, reps: 8, weight: 40 }, { name: "Rudern", sets: 2, reps: 10 }],
    });
    expect(r.status).toBe(201);
    plan = r.data;
  });
  it("legt das Training aus dem Plan an, hakt Sätze ab und schliesst ab", async () => {
    const day = todayInZone();
    const d = await call<GymDay>("GET", `/api/gym/day/${day}`);
    expect(d.data.plan?.id).toBe(plan.id);
    expect(d.data.session).toBeNull();
    const s = await call<GymSession>("POST", `/api/gym/sessions/${day}`, {});
    expect(s.status).toBe(201);
    expect(s.data.sets).toHaveLength(5);
    expect(s.data.sets[0].weight).toBe(40);
    expect((await call<GymSession>("POST", `/api/gym/sessions/${day}`, {})).status).toBe(200);
    await call("PATCH", `/api/gym/sets/${s.data.sets[0].id}`, { done: true, weight: 45 });
    const f = await call<GymSession>("PATCH", `/api/gym/sessions/${day}`, { finished: true });
    expect(f.data.finishedAt).not.toBeNull();
    const days = await call<{ day: string; finished: boolean }[]>("GET", `/api/gym/days?from=${addDays(day, -7)}&to=${day}`);
    expect(days.data).toEqual([{ day, finished: true }]);
    const h = await call<Record<string, { weight: number }[]>>("GET", "/api/gym/history");
    expect(h.data["Bankdrücken"][0].weight).toBe(45);
  });
  it("bearbeitet und löscht Pläne", async () => {
    const r = await call<GymPlan>("PUT", `/api/gym/plans/${plan.id}`, { name: "Neu", weekdays: [1, 3], exercises: [{ id: plan.exercises[0].id, name: "Bank", sets: 4, reps: 6 }] });
    expect(r.data.name).toBe("Neu");
    expect(r.data.weekdays).toEqual([1, 3]);
    expect(r.data.exercises).toHaveLength(1);
    expect(r.data.exercises[0].id).toBe(plan.exercises[0].id);
    expect((await call("PUT", "/api/gym/plans/nope", { name: "x", weekdays: [], exercises: [] })).status).toBe(404);
    expect((await call("POST", "/api/gym/plans", { name: "x", weekdays: [9], exercises: [] })).status).toBe(400);
    expect((await call("DELETE", `/api/gym/plans/${plan.id}`)).status).toBe(200);
  });
  it("trägt ein Training ohne Plan ein", async () => {
    const day = "2026-01-05";
    const r = await call<GymSession>("PATCH", `/api/gym/sessions/${day}`, { finished: true });
    expect(r.data.finishedAt).not.toBeNull();
  });
});

describe("Geld", () => {
  it("rechnet Kontostand aus Buchungen und filtert nach Monat", async () => {
    const a = await call<Account>("POST", "/api/accounts", { id: "acc1", name: "ZKB", openingBalance: 100 });
    expect(a.status).toBe(201);
    await call("POST", "/api/categories", { id: "cat1", name: "Essen" });
    await call("POST", "/api/categories", { id: "cat-snack", name: "Snack" });
    await call("POST", "/api/categories", { id: "cat-ea", name: "Essen auswärts" });
    const bulk = await call("POST", "/api/transactions/bulk", {
      transactions: [
        { accountId: "acc1", categoryId: "cat1", date: "2026-11-02", amount: -12.5, description: "Migros" },
        { accountId: "acc1", date: "2026-10-30", amount: 850 },
      ],
    });
    expect(bulk.status).toBe(201);
    const accs = await call<Account[]>("GET", "/api/accounts");
    expect(accs.data.find((x) => x.id === "acc1")!.balance).toBe(937.5);
    const meal = await call<Transaction>("POST", "/api/transactions", { accountId: "acc1", categoryId: "cat-ea", date: "2026-11-03", amount: -18 });
    expect(meal.data.mealOut).toBe(true);
    const snack = await call<Transaction>("POST", "/api/transactions", { accountId: "acc1", categoryId: "cat-snack", date: "2026-11-03", amount: -3 });
    expect(snack.data.mealOut).toBe(false);
    const toggled = await call<Transaction>("PATCH", `/api/transactions/${snack.data.id}`, { mealOut: true });
    expect(toggled.data.mealOut).toBe(true);
    const settled = await call<Transaction>("PATCH", `/api/transactions/${meal.data.id}`, { settled: true });
    expect(settled.data.settledAt).not.toBeNull();
    expect((await call<Transaction>("PATCH", `/api/transactions/${meal.data.id}`, { settled: false })).data.settledAt).toBeNull();
    const nov = await call<Transaction[]>("GET", "/api/transactions?month=2026-11");
    expect(nov.data).toHaveLength(3);
    expect((await call("POST", "/api/transactions", { accountId: "gibt-es-nicht", date: "2026-11-02", amount: 1 })).status).toBe(400);
    expect((await call("POST", "/api/transactions", { accountId: "acc1", date: "2026-11-02", amount: "x" })).status).toBe(400);
  });
  it("führt Depotwerte und Einzahlungen", async () => {
    const r = await call<InvestmentEntry>("POST", "/api/invest", { kind: "value", date: "2026-11-13", amount: 1200 });
    expect(r.status).toBe(201);
    expect((await call("POST", "/api/invest", { kind: "x", date: "2026-11-13", amount: 1 })).status).toBe(400);
    expect((await call<InvestmentEntry[]>("GET", "/api/invest")).data).toHaveLength(1);
    expect((await call("DELETE", `/api/invest/${r.data.id}`)).status).toBe(200);
  });
});

describe("Körper und Export", () => {
  it("speichert Tageswerte teilweise und überschreibt nur Gelieferte", async () => {
    await call("PUT", "/api/health/2026-11-13", { weightKg: 68.4 });
    const r = await call<HealthDay>("PUT", "/api/health/2026-11-13", { steps: 5000, source: "fitbit" });
    expect(r.data).toMatchObject({ weightKg: 68.4, steps: 5000, sleepMin: null });
    const l = await call<HealthDay[]>("GET", "/api/health?from=2026-11-01");
    expect(l.data).toHaveLength(1);
    expect((await call("PUT", "/api/health/2026-11-13", { weightKg: 5 })).status).toBe(400);
  });
  it("exportiert alles als JSON", async () => {
    const r = await call<Record<string, unknown[]>>("GET", "/api/export");
    expect(r.status).toBe(200);
    for (const k of ["tasks", "settings", "gymPlans", "transactions", "healthDaily", "taskEvents", "investmentEntries"]) expect(Array.isArray(r.data[k])).toBe(true);
  });
});
