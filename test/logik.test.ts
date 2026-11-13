import { describe, expect, it } from "vitest";
import { parseQuick } from "../src/shared/parse";
import { neededGrade, overallAverage, weightedAverage } from "../src/shared/calc";
import { planStudyBlocks } from "../src/shared/lernplan";

const today = "2026-11-13"; // Freitag

describe("Schnelleingabe", () => {
  it("erkennt morgen, Uhrzeit und Dauer", () => {
    expect(parseQuick("Franz lernen morgen 18 Uhr 30 min", today)).toEqual({ title: "Franz lernen", dueDate: "2026-11-14", dueTime: "18:00", durationMin: 30 });
  });
  it("erkennt heute und um 18", () => {
    const r = parseQuick("Zimmer aufräumen heute um 18", today);
    expect(r).toMatchObject({ title: "Zimmer aufräumen", dueDate: today, dueTime: "18:00" });
  });
  it("erkennt Wochentage als nächsten Tag, nie heute", () => {
    expect(parseQuick("Gym am Montag", today).dueDate).toBe("2026-11-16");
    expect(parseQuick("Bericht freitag", today).dueDate).toBe("2026-11-20");
    expect(parseQuick("Test am mi", today).dueDate).toBe("2026-11-18");
  });
  it("erkennt übermorgen, 18:30 und Stunden", () => {
    expect(parseQuick("Lernen übermorgen 18:30 1.5 h", today)).toMatchObject({ dueDate: "2026-11-15", dueTime: "18:30", durationMin: 90 });
  });
  it("lässt Zahlen im Titel stehen und liest Daten", () => {
    expect(parseQuick("Kapitel 3 lernen", today)).toEqual({ title: "Kapitel 3 lernen", dueDate: null, dueTime: null, durationMin: null });
    expect(parseQuick("Abgabe 27.11.", today)).toMatchObject({ title: "Abgabe", dueDate: "2026-11-27", dueTime: null });
    expect(parseQuick("so ein Ding", today).dueDate).toBeNull();
  });
  it("behält den Text, wenn nur Datum da ist", () => {
    expect(parseQuick("morgen", today)).toMatchObject({ title: "morgen", dueDate: "2026-11-14" });
  });
});

describe("Notenrechner", () => {
  const gs = [
    { value: 4, weight: 1 },
    { value: 5, weight: 1 },
  ];
  it("rechnet Schnitte", () => {
    expect(weightedAverage(gs)).toBe(4.5);
    expect(overallAverage([4, null, 5])).toBe(4.5);
    expect(overallAverage([null])).toBeNull();
  });
  it("berechnet die nötige Note", () => {
    expect(neededGrade(gs, 5, 1)).toEqual({ kind: "need", value: 6 });
    expect(neededGrade(gs, 4.5, 1)).toEqual({ kind: "need", value: 4.5 });
    expect(neededGrade(gs, 4, 1)).toEqual({ kind: "need", value: 3 });
    expect(neededGrade(gs, 2, 1)).toEqual({ kind: "reached" });
    expect(neededGrade(gs, 5.5, 1)).toMatchObject({ kind: "impossible" });
    expect(neededGrade([], 4.5, 1)).toEqual({ kind: "need", value: 4.5 });
    expect(neededGrade(gs, 5, 2)).toEqual({ kind: "need", value: 5.5 });
  });
});

describe("Lernblöcke", () => {
  const topics = [
    { title: "A", assessment: 0 },
    { title: "B", assessment: 1 },
    { title: "C", assessment: 2 },
  ];
  it("plant offene doppelt, unsichere einmal, sitzende nie", () => {
    const b = planStudyBlocks({ subject: "W+R", examDate: "2026-11-27", today, topics });
    expect(b.map((x) => x.title)).toEqual(["W+R lernen: A", "W+R lernen: B", "W+R repetieren: A"]);
    expect(b.every((x) => x.date >= today && x.date < "2026-11-27")).toBe(true);
  });
  it("legt den letzten Block auf den Tag vor der Prüfung", () => {
    const b = planStudyBlocks({ subject: "X", examDate: "2026-11-27", today, topics });
    expect(b.at(-1)!.date).toBe("2026-11-26");
    expect(b.map((x) => x.date)).toEqual([...b.map((x) => x.date)].sort());
  });
  it("lässt Tage anderer Prüfungen frei und beginnt nie in der Vergangenheit", () => {
    const b = planStudyBlocks({ subject: "X", examDate: "2026-11-16", today, topics, busyDays: ["2026-11-15"] });
    expect(b.every((x) => x.date !== "2026-11-15" && x.date >= today)).toBe(true);
    expect(b.length).toBe(3);
  });
  it("liefert nichts bei vorbei oder wenn alles sitzt", () => {
    expect(planStudyBlocks({ subject: "X", examDate: today, today, topics })).toEqual([]);
    expect(planStudyBlocks({ subject: "X", examDate: "2026-12-01", today, topics: [{ title: "C", assessment: 2 }] })).toEqual([]);
  });
  it("stapelt Blöcke, wenn weniger Tage als Blöcke da sind", () => {
    const b = planStudyBlocks({ subject: "X", examDate: "2026-11-15", today, topics });
    expect(b).toHaveLength(3);
    expect(new Set(b.map((x) => x.date)).size).toBeLessThanOrEqual(2);
  });
});
