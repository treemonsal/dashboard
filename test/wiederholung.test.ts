import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { buildRule, describeRule, nextDue, parseRepeat } from "../src/shared/recurrence";
import { parseQuick } from "../src/shared/parse";
import { addDays, todayInZone, weekdayNum } from "../src/shared/dates";
import type { Task } from "../src/shared/schemas";

const today = "2026-11-13"; // Freitag

describe("nächstes Datum", () => {
  it("täglich: der Tag nach heute, auch wenn die Aufgabe überfällig war", () => {
    expect(nextDue("FREQ=DAILY", "2026-11-13", today)).toBe("2026-11-14");
    expect(nextDue("FREQ=DAILY", "2026-11-09", today)).toBe("2026-11-14");
    expect(nextDue("FREQ=DAILY", null, today)).toBe("2026-11-14");
  });
  it("früh erledigt: ab der Fälligkeit gezählt, nicht ab heute", () => {
    expect(nextDue("FREQ=DAILY", "2026-11-20", today)).toBe("2026-11-21");
    expect(nextDue("FREQ=DAILY;INTERVAL=3", "2026-11-20", today)).toBe("2026-11-23");
  });
  it("alle n Tage", () => {
    expect(nextDue("FREQ=DAILY;INTERVAL=3", "2026-11-13", today)).toBe("2026-11-16");
    expect(nextDue("FREQ=DAILY;INTERVAL=14", "2026-11-13", today)).toBe("2026-11-27");
  });
  it("werktags: Freitag und Samstag führen auf Montag", () => {
    const rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    expect(nextDue(rule, "2026-11-13", today)).toBe("2026-11-16");
    expect(nextDue(rule, "2026-11-16", "2026-11-16")).toBe("2026-11-17");
    expect(nextDue(rule, "2026-11-12", "2026-11-14")).toBe("2026-11-16"); // Samstag erledigt
  });
  it("wöchentlich an gewählten Tagen", () => {
    const rule = "FREQ=WEEKLY;BYDAY=MO,WE";
    expect(nextDue(rule, "2026-11-16", "2026-11-16")).toBe("2026-11-18");
    expect(nextDue(rule, "2026-11-18", "2026-11-18")).toBe("2026-11-23");
    expect(nextDue(rule, "2026-11-09", "2026-11-17")).toBe("2026-11-18"); // überfällig, Dienstag erledigt
  });
  it("jeden Montag, erledigt am Montag oder später", () => {
    expect(nextDue("FREQ=WEEKLY;BYDAY=MO", "2026-11-16", "2026-11-16")).toBe("2026-11-23");
    expect(nextDue("FREQ=WEEKLY;BYDAY=MO", "2026-11-16", "2026-11-19")).toBe("2026-11-23");
  });
  it("wöchentlich ohne Tag: sieben Tage weiter; alle zwei Wochen", () => {
    expect(nextDue("FREQ=WEEKLY", "2026-11-13", today)).toBe("2026-11-20");
    expect(nextDue("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "2026-11-16", "2026-11-16")).toBe("2026-11-30");
    expect(nextDue("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-11-16", "2026-11-16")).toBe("2026-11-19");
    expect(nextDue("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-11-19", "2026-11-19")).toBe("2026-11-30");
  });
  it("monatlich: gleicher Tag, kurze Monate werden auf den letzten Tag gekürzt", () => {
    expect(nextDue("FREQ=MONTHLY", "2026-11-13", today)).toBe("2026-12-13");
    expect(nextDue("FREQ=MONTHLY", "2026-12-31", "2026-12-31")).toBe("2027-01-31");
    expect(nextDue("FREQ=MONTHLY", "2027-01-31", "2027-01-31")).toBe("2027-02-28");
    expect(nextDue("FREQ=MONTHLY", "2026-12-13", "2026-12-20")).toBe("2027-01-13"); // spät erledigt, sonst überfällig
    expect(nextDue("FREQ=MONTHLY;BYMONTHDAY=1", "2026-11-01", "2026-11-13")).toBe("2026-12-01");
    expect(nextDue("FREQ=MONTHLY;INTERVAL=2", "2026-11-13", today)).toBe("2027-01-13");
  });
  it("jährlich, mit Schalttag", () => {
    expect(nextDue("FREQ=YEARLY", "2026-11-13", today)).toBe("2027-11-13");
    expect(nextDue("FREQ=YEARLY", "2028-02-29", "2028-02-29")).toBe("2029-02-28");
  });
  it("UNTIL beendet die Wiederholung; unbekannte Regeln liefern null", () => {
    expect(nextDue("FREQ=DAILY;UNTIL=20261114", "2026-11-13", today)).toBe("2026-11-14");
    expect(nextDue("FREQ=DAILY;UNTIL=20261113", "2026-11-13", today)).toBeNull();
    expect(nextDue("FREQ=MONTHLY;BYSETPOS=1", "2026-11-13", today)).toBeNull();
    expect(nextDue("kaputt", "2026-11-13", today)).toBeNull();
    expect(nextDue("FREQ=DAILY;COUNT=3", "2026-11-13", today)).toBeNull();
  });
  it("über den Jahreswechsel", () => {
    expect(nextDue("FREQ=DAILY", "2026-12-31", "2026-12-31")).toBe("2027-01-01");
    expect(nextDue("FREQ=WEEKLY;BYDAY=FR", "2026-12-25", "2026-12-25")).toBe("2027-01-01");
  });
});

describe("Auswahl und Regel", () => {
  it("baut Regeln und liest sie zurück", () => {
    expect(buildRule({ kind: "none" })).toBeNull();
    expect(buildRule({ kind: "daily" })).toBe("FREQ=DAILY");
    expect(buildRule({ kind: "weekdays" })).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(buildRule({ kind: "weekly", days: [3, 1] })).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(buildRule({ kind: "weekly", days: [0, 1] })).toBe("FREQ=WEEKLY;BYDAY=MO,SU");
    expect(buildRule({ kind: "weekly", days: [] }, "2026-11-16")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(buildRule({ kind: "weekly", days: [] })).toBe("FREQ=WEEKLY");
    expect(buildRule({ kind: "every", n: 3 })).toBe("FREQ=DAILY;INTERVAL=3");
    expect(buildRule({ kind: "every", n: 1 })).toBe("FREQ=DAILY");
    expect(buildRule({ kind: "every", n: 9999 })).toBe("FREQ=DAILY;INTERVAL=365");
    expect(buildRule({ kind: "monthly" })).toBe("FREQ=MONTHLY");
    for (const r of ["FREQ=DAILY", "FREQ=DAILY;INTERVAL=3", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "FREQ=WEEKLY;BYDAY=MO,WE", "FREQ=MONTHLY", "FREQ=YEARLY"]) {
      expect(buildRule(parseRepeat(r))).toBe(r);
    }
    expect(parseRepeat(null)).toEqual({ kind: "none" });
    expect(parseRepeat("FREQ=MONTHLY;BYSETPOS=1")).toEqual({ kind: "other" });
    expect(parseRepeat("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO")).toEqual({ kind: "other" });
  });
  it("beschreibt kurz", () => {
    expect(describeRule(null)).toBe("");
    expect(describeRule("FREQ=DAILY")).toBe("täglich");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO")).toBe("jeden Montag");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Mo, Mi");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("werktags");
    expect(describeRule("FREQ=DAILY;INTERVAL=3")).toBe("alle 3 Tage");
    expect(describeRule("FREQ=MONTHLY")).toBe("monatlich");
  });
});

describe("Schnelleingabe mit Wiederholung", () => {
  const p = (s: string) => parseQuick(s, today);
  it("jeden Montag", () => {
    expect(p("Müll rausbringen jeden Montag")).toEqual({ title: "Müll rausbringen", dueDate: "2026-11-16", dueTime: null, durationMin: null, recurrence: "FREQ=WEEKLY;BYDAY=MO" });
  });
  it("beginnt heute, wenn heute der gewünschte Wochentag ist", () => {
    expect(p("Wäsche jeden Freitag")).toMatchObject({ dueDate: "2026-11-13", recurrence: "FREQ=WEEKLY;BYDAY=FR" });
  });
  it("mehrere Tage: und, Komma, Mehrzahlform", () => {
    expect(p("Gym jeden Montag und Mittwoch")).toMatchObject({ title: "Gym", dueDate: "2026-11-16", recurrence: "FREQ=WEEKLY;BYDAY=MO,WE" });
    expect(p("Gym jeden Montag, Mittwoch und Freitag")).toMatchObject({ title: "Gym", recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR" });
    expect(p("Lernen montags und donnerstags")).toMatchObject({ title: "Lernen", recurrence: "FREQ=WEEKLY;BYDAY=MO,TH" });
  });
  it("täglich mit Uhrzeit und Dauer", () => {
    expect(p("Zähne täglich um 21 Uhr")).toEqual({ title: "Zähne", dueDate: today, dueTime: "21:00", durationMin: null, recurrence: "FREQ=DAILY" });
    expect(p("Lesen jeden Tag 20 min")).toMatchObject({ title: "Lesen", durationMin: 20, recurrence: "FREQ=DAILY" });
  });
  it("jede Woche nimmt den Wochentag des Datums", () => {
    expect(p("Putzen jede Woche")).toMatchObject({ title: "Putzen", dueDate: today, recurrence: "FREQ=WEEKLY;BYDAY=FR" });
    expect(p("Putzen jede Woche Mittwoch")).toMatchObject({ title: "Putzen", dueDate: "2026-11-18", recurrence: "FREQ=WEEKLY;BYDAY=WE" });
    expect(p("Putzen wöchentlich")).toMatchObject({ recurrence: "FREQ=WEEKLY;BYDAY=FR" });
  });
  it("werktags, alle n Tage, monatlich, jährlich", () => {
    expect(p("Mails werktags")).toMatchObject({ title: "Mails", dueDate: today, recurrence: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" });
    expect(parseQuick("Mails werktags", "2026-11-14")).toMatchObject({ dueDate: "2026-11-16" });
    expect(p("Pflanzen giessen alle 3 Tage")).toMatchObject({ title: "Pflanzen giessen", recurrence: "FREQ=DAILY;INTERVAL=3" });
    expect(p("Zimmer alle 2 Wochen")).toMatchObject({ recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR" });
    expect(p("Abo prüfen jeden Monat")).toMatchObject({ title: "Abo prüfen", recurrence: "FREQ=MONTHLY" });
    expect(p("Geburtstag Oma jährlich 3.12.")).toMatchObject({ dueDate: "2026-12-03", recurrence: "FREQ=YEARLY" });
  });
  it("lässt normale Eingaben unberührt", () => {
    expect(p("Bericht schreiben morgen")).toMatchObject({ recurrence: null, dueDate: "2026-11-14" });
    expect(p("Montag Termin")).toMatchObject({ recurrence: null });
    expect(p("täglich")).toMatchObject({ title: "täglich", recurrence: "FREQ=DAILY" });
  });
});

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await exports.default.fetch("http://localhost" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as T };
}
const open = async (title: string) => (await call<Task[]>("GET", "/api/tasks")).data.filter((t) => t.title === title && !t.doneAt);

describe("Wiederkehrende Aufgaben (API)", () => {
  it("erzeugt beim Erledigen die nächste, mit denselben Angaben", async () => {
    const due = addDays(todayInZone(), 5);
    const t = await call<Task>("POST", "/api/tasks", { title: "Täglich A", dueDate: due, dueTime: "07:15", durationMin: 10, priority: 2, notes: "Notiz", recurrence: "FREQ=DAILY" });
    expect(t.status).toBe(201);
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true });
    const next = await open("Täglich A");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ dueDate: addDays(due, 1), dueTime: "07:15", durationMin: 10, priority: 2, notes: "Notiz", recurrence: "FREQ=DAILY" });
    expect(next[0].id).not.toBe(t.data.id);
  });
  it("zweimal Erledigen erzeugt nur eine Folgeaufgabe", async () => {
    const t = await call<Task>("POST", "/api/tasks", { title: "Einmal", dueDate: addDays(todayInZone(), 3), recurrence: "FREQ=DAILY" });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true });
    expect(await open("Einmal")).toHaveLength(1);
  });
  it("Zurücknehmen entfernt die unberührte Folgeaufgabe wieder", async () => {
    const t = await call<Task>("POST", "/api/tasks", { title: "Zurück", dueDate: addDays(todayInZone(), 4), recurrence: "FREQ=DAILY" });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true });
    expect(await open("Zurück")).toHaveLength(1);
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: false });
    const now = await open("Zurück");
    expect(now).toHaveLength(1);
    expect(now[0].id).toBe(t.data.id);
  });
  it("Folgeaufgabe, die schon erledigt wurde, bleibt beim Zurücknehmen", async () => {
    const t = await call<Task>("POST", "/api/tasks", { title: "Bleibt", dueDate: addDays(todayInZone(), 4), recurrence: "FREQ=DAILY" });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true });
    const [next] = await open("Bleibt");
    await call("PATCH", `/api/tasks/${next.id}`, { done: true });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: false });
    const all = (await call<Task[]>("GET", "/api/tasks")).data.filter((x) => x.title === "Bleibt");
    expect(all.some((x) => x.id === next.id)).toBe(true);
  });
  it("werktags und gewählte Tage", async () => {
    const due = addDays(todayInZone(), 7);
    const t = await call<Task>("POST", "/api/tasks", { title: "Werktags", dueDate: due, recurrence: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true });
    const [n] = await open("Werktags");
    const wd = weekdayNum(n.dueDate!);
    expect(wd >= 1 && wd <= 5).toBe(true);
    expect(n.dueDate! > due).toBe(true);
    expect(n.dueDate! <= addDays(due, 3)).toBe(true);
    const w = await call<Task>("POST", "/api/tasks", { title: "Zwei Tage", dueDate: due, recurrence: "FREQ=WEEKLY;BYDAY=MO,TH" });
    await call("PATCH", `/api/tasks/${w.data.id}`, { done: true });
    const [m] = await open("Zwei Tage");
    expect([1, 4]).toContain(weekdayNum(m.dueDate!));
  });
  it("ohne Regel entsteht nichts; ungültige Regel wird abgelehnt", async () => {
    const t = await call<Task>("POST", "/api/tasks", { title: "Normal", dueDate: todayInZone() });
    await call("PATCH", `/api/tasks/${t.data.id}`, { done: true });
    expect(await open("Normal")).toHaveLength(0);
    expect((await call("POST", "/api/tasks", { title: "Kaputt", recurrence: "jeden Montag" })).status).toBe(400);
  });
  it("Regel lässt sich per Änderung setzen und entfernen", async () => {
    const t = await call<Task>("POST", "/api/tasks", { title: "Später", dueDate: addDays(todayInZone(), 2) });
    const a = await call<Task>("PATCH", `/api/tasks/${t.data.id}`, { recurrence: "FREQ=WEEKLY;BYDAY=MO" });
    expect(a.data.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO");
    const b = await call<Task>("PATCH", `/api/tasks/${t.data.id}`, { recurrence: null });
    expect(b.data.recurrence).toBeNull();
  });
});
