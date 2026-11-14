import { describe, expect, it } from "vitest";
import { median, normTitle, similar, suggestDay, suggestTime, type LearnEvent } from "../src/shared/vorschlag";

const ev = (title: string, weekday: number, doneTime: string, durationMin: number | null = 30): LearnEvent => ({ title, weekday, doneTime, durationMin });
const base = { workDays: [1, 2, 3], schoolDays: [4, 5], wake: "06:30" };

describe("Vorschläge: Grundlagen", () => {
  it("Median und Titelvergleich", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(normTitle("Kapitel 3 lernen!")).toBe("kapitel lernen");
    expect(similar("Franz lernen", "franz lernen 2")).toBe(true);
    expect(similar("Wäsche", "Zimmer")).toBe(false);
    expect(similar("", "")).toBe(false);
  });
});

describe("Vorschläge: Uhrzeit", () => {
  const sat = [ev("Wäsche", 6, "10:30"), ev("Wäsche", 6, "10:50"), ev("Wäsche", 6, "11:10"), ev("Wäsche", 0, "20:00")];
  it("nimmt den Median am selben Wochentag", () => {
    expect(suggestTime({ ...base, events: sat, title: "Wäsche", durationMin: null, weekday: 6, busy: [] })).toEqual({ time: "10:50", basedOn: 3 });
  });
  it("macht ohne genug Daten keinen Vorschlag", () => {
    expect(suggestTime({ ...base, events: sat.slice(0, 2), title: "Wäsche", durationMin: null, weekday: 6, busy: [] })).toBeNull();
    expect(suggestTime({ ...base, events: sat, title: "Wäsche", durationMin: null, weekday: 0, busy: [] })).toBeNull();
    expect(suggestTime({ ...base, events: sat, title: "Putzen", durationMin: null, weekday: 6, busy: [] })).toBeNull();
  });
  it("weicht einem Termin aus und nimmt die nächste freie Lücke", () => {
    const r = suggestTime({ ...base, events: sat, title: "Wäsche", durationMin: 40, weekday: 6, busy: [{ start: 10 * 60 + 30, end: 12 * 60 }] });
    expect(r?.time).toBe("12:00");
  });
  it("sperrt Arbeitstage bis 17:00 und Schultage bis 16:30", () => {
    const mon = [ev("Hausaufgaben", 1, "12:00"), ev("Hausaufgaben", 1, "12:10"), ev("Hausaufgaben", 1, "12:20")];
    expect(suggestTime({ ...base, events: mon, title: "Hausaufgaben", durationMin: 30, weekday: 1, busy: [] })?.time).toBe("17:00");
    const thu = mon.map((e) => ({ ...e, weekday: 4 }));
    expect(suggestTime({ ...base, events: thu, title: "Hausaufgaben", durationMin: 30, weekday: 4, busy: [] })?.time).toBe("16:30");
  });
  it("schlägt nichts nach 21:30 vor", () => {
    const late = [ev("Lesen", 6, "21:20"), ev("Lesen", 6, "21:25"), ev("Lesen", 6, "21:30")];
    expect(suggestTime({ ...base, events: late, title: "Lesen", durationMin: 30, weekday: 6, busy: [] })?.time).toBe("21:00");
    expect(suggestTime({ ...base, events: late, title: "Lesen", durationMin: 30, weekday: 6, busy: [{ start: 0, end: 21 * 60 + 30 }] })).toBeNull();
  });
  it("nimmt die übliche Dauer, wenn die Aufgabe keine hat", () => {
    const e = [ev("Lesen", 6, "20:00", 90), ev("Lesen", 6, "20:00", 90), ev("Lesen", 6, "20:00", 90)];
    expect(suggestTime({ ...base, events: e, title: "Lesen", durationMin: null, weekday: 6, busy: [{ start: 21 * 60, end: 22 * 60 }] })?.time).toBe("19:30");
  });
});

describe("Vorschläge: heute", () => {
  it("legt nichts in die Vergangenheit", () => {
    const sat = [ev("Wäsche", 6, "10:30"), ev("Wäsche", 6, "10:30"), ev("Wäsche", 6, "10:30")];
    expect(suggestTime({ ...base, events: sat, title: "Wäsche", durationMin: 30, weekday: 6, busy: [], from: 14 * 60 + 22 })?.time).toBe("14:25");
  });
});

describe("Vorschläge: ganzer Tag", () => {
  it("belegt Lücken nacheinander und überspringt Aufgaben mit Uhrzeit", () => {
    const events = [ev("Wäsche", 6, "10:00"), ev("Wäsche", 6, "10:00"), ev("Wäsche", 6, "10:00"), ev("Zimmer aufräumen", 6, "10:00"), ev("Zimmer aufräumen", 6, "10:00"), ev("Zimmer aufräumen", 6, "10:00")];
    const m = suggestDay({
      ...base, weekday: 6, events, appointments: [],
      tasks: [
        { id: "a", title: "Wäsche", dueTime: null, durationMin: null, done: false },
        { id: "b", title: "Zimmer aufräumen", dueTime: null, durationMin: null, done: false },
        { id: "c", title: "Wäsche", dueTime: "09:00", durationMin: null, done: false },
        { id: "d", title: "Wäsche", dueTime: null, durationMin: null, done: true },
      ],
    });
    expect(m.get("a")?.time).toBe("10:00");
    expect(m.get("b")?.time).toBe("10:30");
    expect(m.has("c")).toBe(false);
    expect(m.has("d")).toBe(false);
  });
});
