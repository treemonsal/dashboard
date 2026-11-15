import { describe, expect, it } from "vitest";
import { inWeek, merchantOf, monthsWithData, sameMerchant, shiftMonth, slug, spendPerDay, sumsByWeek, weekOfDate, weeksOfMonth } from "../src/shared/tiefe";

const tx = (id: string, date: string, amount: number, extra: Record<string, unknown> = {}) => ({ id, date, amount, mealOut: false, isRepayment: false, settledAt: null, categoryId: null, ...extra });

describe("tiefe: Wochen", () => {
  it("teilt Monate in Blöcke zu 7 Tagen", () => {
    expect(weeksOfMonth("2026-10").map((w) => [w.from.slice(8), w.to.slice(8)])).toEqual([["01", "07"], ["08", "14"], ["15", "21"], ["22", "28"], ["29", "31"]]);
    expect(weeksOfMonth("2026-02").length).toBe(4);
    expect(weeksOfMonth("2024-02").at(-1)).toMatchObject({ n: 5, from: "2024-02-29", to: "2024-02-29" });
    expect(weeksOfMonth("2026-11").at(-1)!.to).toBe("2026-11-30");
  });
  it("ordnet Daten zu", () => {
    expect([1, 7, 8, 28, 29, 31].map((d) => weekOfDate(`2026-10-${String(d).padStart(2, "0")}`))).toEqual([1, 1, 2, 4, 5, 5]);
  });
  it("summiert eigene Anteile je Woche, Mahlzeit halb, eigene Überweisung nie", () => {
    const t = [tx("a", "2026-10-02", -10), tx("b", "2026-10-09", -20, { mealOut: true }), tx("c", "2026-10-10", -50, { internal: true }), tx("d", "2026-10-30", 100)];
    expect(sumsByWeek(t, "2026-10")).toEqual([10, 10, 0, 0, 0]);
    expect(inWeek(t, "2026-10", 2).map((x) => x.id)).toEqual(["b", "c"]);
    expect(spendPerDay(t, "2026-10")[8]).toBe(10);
  });
  it("verschiebt Monate", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthsWithData([tx("a", "2026-09-01", 1), tx("b", "2026-10-01", 1)])).toEqual(["2026-10", "2026-09"]);
  });
});

describe("tiefe: Adressen und Händler", () => {
  it("slug", () => {
    expect(slug("Sparen/Anlage")).toBe("sparen-anlage");
    expect(slug("Essen auswärts")).toBe("essen-auswaerts");
    expect(slug(null)).toBe("ohne");
  });
  it("Händler aus Revolut-Text", () => {
    expect(merchantOf("Denner An: Denner Ag Zh Limmatstr, Zürich, CHE Karte: 542402******5139")).toEqual({ key: "denner", name: "Denner" });
    expect(merchantOf("SBB CFF FFS An: Sbb Cff Ffs Mobile Tic, Bern").name).toBe("SBB CFF FFS");
    expect(merchantOf("Überweisung an TIMO KLAUS HAHN Referenz: Wechseln zu yuh An: ").name).toBe("Überweisung an TIMO KLAUS HAHN");
  });
  it("Händler aus Yuh-Text", () => {
    expect(merchantOf("Zahlung per Debitkarte 1200432140 xxxx 5271 - VOI CH Zahlerweg 6 6300 Zug").name).toBe("VOI CH");
    expect(merchantOf("TWINT-Zahlung 1186895867 TWINT booking id 002225262398 HAHN").name).toBe("TWINT-Zahlung");
    expect(merchantOf("Zahlung von 1199483427 SWISSCOM (SCHWEIZ) AG ALTE TIEFENAUSTRASSE 6 CH").name).toBe("SWISSCOM (SCHWEIZ) AG");
    expect(merchantOf(null).key).toBe("unbekannt");
  });
  it("gleicher Händler", () => {
    const a = tx("a", "2026-10-01", -3, { description: "Denner An: x" }), b = tx("b", "2026-10-02", -4, { description: "Denner An: y" }), c = tx("c", "2026-10-02", -4, { description: "Coop An: y" });
    expect(sameMerchant([a, b, c], a).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

import { mapSleepNights } from "../src/server/health/map";
describe("tiefe: Nächte aus Google Health", () => {
  const night = (s: string, e: string, stages: [string, string, string][], extra: Record<string, unknown> = {}) => ({
    sleep: { interval: { startTime: s, endTime: e }, summary: { minutesAsleep: "400", minutesAwake: "30" }, metadata: extra, stages: stages.map(([type, startTime, endTime]) => ({ type, startTime, endTime })) },
  });
  it("liest Zeiten und Phasen, Tag des Aufwachens", () => {
    const res = { dataPoints: [night("2026-11-12T21:30:00Z", "2026-11-13T05:30:00Z", [["DEEP", "2026-11-12T22:00:00Z", "2026-11-12T23:00:00Z"], ["LIGHT", "2026-11-12T23:00:00Z", "2026-11-13T02:00:00Z"], ["REM", "2026-11-13T02:00:00Z", "2026-11-13T03:00:00Z"], ["AWAKE", "2026-11-13T03:00:00Z", "2026-11-13T03:30:00Z"]])] };
    expect(mapSleepNights(res)).toEqual([{ day: "2026-11-13", startAt: "2026-11-12T21:30:00.000Z", endAt: "2026-11-13T05:30:00.000Z", asleepMin: 400, awakeMin: 30, deepMin: 60, lightMin: 180, remMin: 60 }]);
  });
  it("ohne Stufen bleiben Phasen leer, Nickerchen zählen nicht, Teilnächte werden vereint", () => {
    const res = { dataPoints: [night("2026-11-12T21:00:00Z", "2026-11-13T01:00:00Z", []), night("2026-11-13T02:00:00Z", "2026-11-13T05:00:00Z", []), night("2026-11-13T11:00:00Z", "2026-11-13T12:00:00Z", [], { nap: true })] };
    const n = mapSleepNights(res);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ startAt: "2026-11-12T21:00:00.000Z", endAt: "2026-11-13T05:00:00.000Z", asleepMin: 800, deepMin: null });
  });
});

import { avgOf, diffPct, mondaysBetween, weekAverages, weekDays } from "../src/shared/tiefe";
describe("tiefe: Wochen Montag bis Sonntag", () => {
  it("Montage und Schnitte", () => {
    expect(mondaysBetween("2026-11-12", "2026-11-15")).toEqual(["2026-11-09"]);
    expect(mondaysBetween("2026-11-01", "2026-11-15")).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(weekDays("2026-11-09")[6]).toBe("2026-11-15");
    const m = new Map<string, number | null>([["2026-11-09", 400], ["2026-11-10", 500], ["2026-11-11", null]]);
    expect(weekAverages(m, ["2026-11-09", "2026-11-16"])).toEqual([{ monday: "2026-11-09", avg: 450, n: 2 }, { monday: "2026-11-16", avg: null, n: 0 }]);
    expect(avgOf([])).toBeNull();
    expect(diffPct(110, 100)).toBeCloseTo(10);
    expect(diffPct(1, null)).toBeNull();
  });
});

import { gradeImpact, taskTopic } from "../src/shared/tiefe";
describe("tiefe: Schule", () => {
  it("wie eine Note den Fachschnitt verschoben hat", () => {
    const g = [{ id: "a", value: 5, weight: 1, date: "2026-09-01" }, { id: "b", value: 4, weight: 1, date: "2026-10-01" }, { id: "c", value: 3, weight: 2, date: "2026-11-01" }];
    expect(gradeImpact(g, "a")).toEqual({ before: null, after: 5, delta: null });
    expect(gradeImpact(g, "b")).toEqual({ before: 5, after: 4.5, delta: -0.5 });
    expect(gradeImpact(g, "c")!.after).toBeCloseTo(3.75);
    expect(gradeImpact(g, "x")).toBeNull();
  });
  it("Lernaufgabe zu Thema", () => {
    const topics = [{ title: "Past tense" }, { title: "Reading" }];
    expect(taskTopic({ title: "E lernen: Past tense", examId: "x" }, topics)).toBe(topics[0]);
    expect(taskTopic({ title: "E repetieren: Reading", examId: "x" }, topics)).toBe(topics[1]);
    expect(taskTopic({ title: "E lernen: Past tense", examId: null }, topics)).toBeNull();
    expect(taskTopic({ title: "Einkaufen", examId: "x" }, topics)).toBeNull();
  });
});
