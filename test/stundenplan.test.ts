import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { blocksOn, isoWeekday, lessonBlocks, lessonsOn, type Lesson } from "../src/shared/stundenplan";
import { suggestDay, suggestTime, type LearnEvent } from "../src/shared/vorschlag";
import { MAX_LESSONS, timetableReplace } from "../src/shared/schemas";

const L = (weekday: number, startTime: string, endTime: string, subject: string, extra: Partial<Lesson> = {}): Lesson => ({ weekday, startTime, endTime, subject, room: null, teacher: null, validFrom: null, ...extra });

// 2026-11-12 ist ein Donnerstag, 2026-11-15 ein Sonntag.
describe("Stundenplan: Tage und Blöcke", () => {
  it("Wochentag 1 bis 7, Sonntag ist 7", () => {
    expect(isoWeekday("2026-11-12")).toBe(4);
    expect(isoWeekday("2026-11-15")).toBe(7);
    expect(isoWeekday("2026-11-16")).toBe(1);
  });

  it("fasst aufeinanderfolgende Lektionen desselben Fachs zusammen, andere Fächer und grosse Lücken nicht", () => {
    const day = [L(4, "09:35", "10:20", "M"), L(4, "07:30", "08:15", "E", { room: "A12" }), L(4, "08:15", "09:00", "E", { room: "A13" }), L(4, "13:00", "13:45", "E"), L(4, "10:20", "11:05", "M")];
    expect(lessonBlocks(day)).toEqual([
      { subject: "E", startMin: 450, endMin: 540, room: "A12", teacher: null, lessons: 2 },
      { subject: "M", startMin: 575, endMin: 665, room: null, teacher: null, lessons: 2 },
      { subject: "E", startMin: 780, endMin: 825, room: null, teacher: null, lessons: 1 },
    ]);
    // Dazwischen ein anderes Fach: kein Zusammenfassen.
    expect(lessonBlocks([L(4, "08:00", "08:45", "E"), L(4, "08:45", "09:30", "M"), L(4, "09:30", "10:15", "E")])).toHaveLength(3);
  });

  it("nimmt nur den passenden Wochentag", () => {
    const tt = [L(4, "08:00", "08:45", "E"), L(5, "08:00", "08:45", "M")];
    expect(lessonsOn(tt, "2026-11-12").map((l) => l.subject)).toEqual(["E"]);
    expect(lessonsOn(tt, "2026-11-13").map((l) => l.subject)).toEqual(["M"]);
    expect(lessonsOn(tt, "2026-11-14")).toEqual([]);
  });

  it("Schulferien blenden Lektionen bis und mit dem Datum aus", () => {
    const tt = [L(4, "08:00", "08:45", "E")];
    expect(blocksOn(tt, "2026-11-12", "2026-11-12")).toEqual([]);
    expect(blocksOn(tt, "2026-11-12", "2026-11-11")).toHaveLength(1);
    expect(blocksOn(tt, "2026-11-19", "2026-11-12")).toHaveLength(1);
    expect(blocksOn(tt, "2026-11-12", "")).toHaveLength(1);
    expect(blocksOn(tt, "2026-11-12", null)).toHaveLength(1);
  });

  it("gültig ab: ab dem Datum gilt nur die neue Fassung", () => {
    const tt = [L(4, "08:00", "08:45", "E"), L(4, "10:00", "10:45", "M", { validFrom: "2026-11-19" })];
    expect(lessonsOn(tt, "2026-11-12").map((l) => l.subject)).toEqual(["E"]);
    expect(lessonsOn(tt, "2026-11-19").map((l) => l.subject)).toEqual(["M"]);
    expect(lessonsOn([L(4, "10:00", "10:45", "M", { validFrom: "2026-11-19" })], "2026-11-12")).toEqual([]);
  });
});

describe("Stundenplan: Eingabe", () => {
  const ok = { weekday: 4, startTime: "08:00", endTime: "08:45", subject: "E" };
  it("normalisiert leere Felder", () => {
    const r = timetableReplace.parse({ lessons: [{ ...ok, room: " ", teacher: "Frau Muster", validFrom: "2026-11-12" }] });
    expect(r.lessons[0]).toMatchObject({ room: null, teacher: "Frau Muster", validFrom: "2026-11-12" });
  });
  it("lehnt Ungültiges ab", () => {
    for (const bad of [{ weekday: 0 }, { weekday: 8 }, { weekday: 1.5 }, { startTime: "8:00" }, { endTime: "08:00" }, { endTime: "07:00" }, { subject: "" }, { subject: "x".repeat(21) }, { room: "x".repeat(41) }, { validFrom: "2026-13-01" }, { extra: 1 }]) {
      expect(timetableReplace.safeParse({ lessons: [{ ...ok, ...bad }] }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(timetableReplace.safeParse({ lessons: [ok, ok] }).success).toBe(false);
    expect(timetableReplace.safeParse({ lessons: [ok], x: 1 }).success).toBe(false);
  });
  it("höchstens 80 Einträge", () => {
    const many = (n: number) => ({ lessons: Array.from({ length: n }, (_, i) => ({ ...ok, weekday: 1 + (i % 7), startTime: `${String(7 + Math.floor(i / 7)).padStart(2, "0")}:00`, endTime: `${String(7 + Math.floor(i / 7)).padStart(2, "0")}:45` })) });
    expect(timetableReplace.safeParse(many(MAX_LESSONS)).success).toBe(true);
    expect(timetableReplace.safeParse(many(MAX_LESSONS + 1)).success).toBe(false);
  });
});

describe("Vorschläge mit Stundenplan", () => {
  const ev = (title: string, weekday: number, doneTime: string): LearnEvent => ({ title, weekday, doneTime, durationMin: 30 });
  const thu = [ev("Hausaufgaben", 4, "12:00"), ev("Hausaufgaben", 4, "12:10"), ev("Hausaufgaben", 4, "12:20")];
  const base = { workDays: [1, 2, 3], schoolDays: [4, 5], wake: "06:30", events: thu, title: "Hausaufgaben", durationMin: 30, weekday: 4 };

  it("ohne Stundenplan: pauschal bis 16:30 gesperrt", () => {
    expect(suggestTime({ ...base, busy: [] })?.time).toBe("16:30");
  });
  it("mit Stundenplan: nur die Lektionen sperren", () => {
    // Zwischenstunde um 12:00 ist frei.
    expect(suggestTime({ ...base, busy: [{ start: 7 * 60 + 30, end: 11 * 60 + 30 }, { start: 13 * 60, end: 15 * 60 }], hasTimetable: true })?.time).toBe("12:10");
    // Lektionen bis 15:00: der Vorschlag um 12:10 liegt in der Lektion und rückt dahinter.
    expect(suggestTime({ ...base, busy: [{ start: 7 * 60 + 30, end: 15 * 60 }], hasTimetable: true })?.time).toBe("15:00");
  });
  it("Arbeitstage bleiben pauschal gesperrt, auch mit Stundenplan", () => {
    const mon = ["12:00", "12:10", "12:20"].map((t) => ev("Hausaufgaben", 1, t));
    expect(suggestTime({ ...base, events: mon, weekday: 1, busy: [], hasTimetable: true })?.time).toBe("17:00");
  });
  it("suggestDay: lessons belegen die Zeit, leere Liste gibt den Tag frei, null lässt die Pauschale", () => {
    const tasks = [{ id: "t1", title: "Hausaufgaben", dueTime: null, durationMin: 30, done: false }];
    const o = { weekday: 4, tasks, events: thu, appointments: [], workDays: [1, 2, 3], schoolDays: [4, 5], wake: "06:30" };
    expect(suggestDay({ ...o, lessons: [{ start: 450, end: 15 * 60 }] }).get("t1")?.time).toBe("15:00");
    expect(suggestDay({ ...o, lessons: [] }).get("t1")?.time).toBe("12:10");
    expect(suggestDay({ ...o, lessons: null }).get("t1")?.time).toBe("16:30");
    expect(suggestDay(o).get("t1")?.time).toBe("16:30");
  });
});

async function call(method: string, path: string, body?: unknown) {
  const res = await exports.default.fetch("http://localhost" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}

describe("API /api/timetable", () => {
  const a = { weekday: 4, startTime: "07:30", endTime: "08:15", subject: "E", room: "A12", teacher: "Frau Muster" };
  const b = { weekday: 5, startTime: "08:15", endTime: "09:00", subject: "M" };

  it("leer, ersetzen vollständig, lesen sortiert", async () => {
    expect((await call("GET", "/api/timetable")).data).toEqual({ lessons: [] });
    const put = await call("PUT", "/api/timetable", { lessons: [b, a] });
    expect(put.status).toBe(200);
    const got = (await call("GET", "/api/timetable")).data.lessons;
    expect(got.map((l: { subject: string }) => l.subject)).toEqual(["E", "M"]);
    expect(got[0]).toMatchObject({ room: "A12", teacher: "Frau Muster", validFrom: null });
    // Ersetzen heisst: der Rest ist weg.
    await call("PUT", "/api/timetable", { lessons: [b] });
    expect((await call("GET", "/api/timetable")).data.lessons.map((l: { subject: string }) => l.subject)).toEqual(["M"]);
  });

  it("ungültige Eingabe ändert nichts (400), mehr als 80 ebenfalls", async () => {
    await call("PUT", "/api/timetable", { lessons: [a] });
    expect((await call("PUT", "/api/timetable", { lessons: [a, { ...b, endTime: "08:00" }] })).status).toBe(400);
    expect((await call("PUT", "/api/timetable", { lessons: Array.from({ length: 81 }, (_, i) => ({ ...a, weekday: 1 + (i % 7), startTime: `${String(7 + Math.floor(i / 7)).padStart(2, "0")}:00`, endTime: `${String(7 + Math.floor(i / 7)).padStart(2, "0")}:30` })) })).status).toBe(400);
    expect((await call("PUT", "/api/timetable", {})).status).toBe(400);
    expect((await call("GET", "/api/timetable")).data.lessons).toHaveLength(1);
  });

  it("Leere Liste leert den Stundenplan; Export enthält ihn; Ferien-Einstellung", async () => {
    await call("PUT", "/api/timetable", { lessons: [a] });
    expect((await call("GET", "/api/export")).data.timetable).toHaveLength(1);
    expect((await call("PUT", "/api/timetable", { lessons: [] })).data).toEqual({ lessons: [] });
    expect((await call("GET", "/api/settings")).data.schoolHolidayUntil).toBe("");
    expect((await call("PUT", "/api/settings", { schoolHolidayUntil: "2026-11-30" })).data.schoolHolidayUntil).toBe("2026-11-30");
    expect((await call("PUT", "/api/settings", { schoolHolidayUntil: "morgen" })).status).toBe(400);
    expect((await call("PUT", "/api/settings", { schoolHolidayUntil: "" })).data.schoolHolidayUntil).toBe("");
  });
});
