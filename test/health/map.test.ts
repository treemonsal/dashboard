import { describe, expect, it } from "vitest";
import { civilDate, durationSeconds, mapExercise, mapRestingHr, mapSleep, mapSteps, mapWeight, toDays, zurichDay, type Acc } from "../../src/server/health/map";
import * as fx from "./fixtures";

const run = () => {
  const acc: Acc = new Map();
  mapSteps(fx.stepsRollup, acc);
  mapRestingHr(fx.restingHr, acc);
  mapWeight(fx.weight, acc);
  mapSleep(fx.sleep, acc);
  return Object.fromEntries(toDays(acc).map((d) => [d.day, d]));
};

describe("Zuordnung der Felder", () => {
  it("Schritte und Ruhepuls: Text-Zahlen werden gelesen", () => {
    const d = run();
    expect(d["2026-11-12"].steps).toBe(8421);
    expect(d["2026-11-13"].steps).toBe(10032);
    expect(d["2026-11-13"].restingHr).toBe(58);
    expect(d["2026-11-12"].restingHr).toBe(61);
  });
  it("Gewicht: späteste Wägung des Tages, Gramm in Kilogramm, Zürcher Tag", () => {
    const d = run();
    expect(d["2026-11-12"].weightKg).toBe(68.9);
    // 23:30 UTC ist 00:30 in Zürich: gehört zum 14.
    expect(d["2026-11-14"].weightKg).toBe(68);
    expect(d["2026-11-13"].weightKg).toBeNull();
  });
  it("Schlaf zählt zum Aufwachtag, Nickerchen nicht, Minuten Schlaf ohne Wachphasen", () => {
    const d = run();
    expect(d["2026-11-13"].sleepMin).toBe(441);
    expect(d["2026-11-12"]?.sleepMin ?? null).toBeNull(); // nur Nickerchen
    // Ende 23:20 UTC = 00:20 am 14. in Zürich
    expect(d["2026-11-14"].sleepMin).toBe(30);
  });
  it("Mehrteilige Nacht wird addiert", () => {
    const acc: Acc = new Map();
    const part = (s: string, e: string, m: string) => ({ sleep: { interval: { startTime: s, endTime: e }, summary: { minutesAsleep: m }, metadata: { nap: false } } });
    mapSleep({ dataPoints: [part("2026-11-13T21:00:00Z", "2026-11-14T01:00:00Z", "200"), part("2026-11-14T01:30:00Z", "2026-11-14T05:30:00Z", "220")] }, acc);
    expect(acc.get("2026-11-14")?.sleepMin).toBe(420);
  });
  it("Ohne Zusammenfassung zählen die Stufen ausser AWAKE", () => {
    const acc: Acc = new Map();
    mapSleep(
      {
        dataPoints: [
          {
            sleep: {
              interval: { startTime: "2026-11-13T22:00:00Z", endTime: "2026-11-14T05:00:00Z" },
              stages: [
                { type: "LIGHT", startTime: "2026-11-13T22:00:00Z", endTime: "2026-11-14T01:00:00Z" },
                { type: "AWAKE", startTime: "2026-11-14T01:00:00Z", endTime: "2026-11-14T01:30:00Z" },
                { type: "DEEP", startTime: "2026-11-14T01:30:00Z", endTime: "2026-11-14T05:00:00Z" },
              ],
            },
          },
        ],
      },
      acc,
    );
    expect(acc.get("2026-11-14")?.sleepMin).toBe(390);
  });
  it("Training: Tag des Beginns in Zürich, Dauer aus activeDuration, gerundet", () => {
    const w = mapExercise(fx.exercise, (s) => "id" + s);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ day: "2026-11-13", type: "STRENGTH_TRAINING", name: "Krafttraining", minutes: 65, kcal: 312, avgHr: 118, startAt: "2026-11-13T16:30:00.000Z" });
    // Ohne activeDuration: Ende minus Beginn
    expect(w[1]).toMatchObject({ day: "2026-11-12", minutes: 20, kcal: null, avgHr: null });
  });
  it("Unbrauchbare Einträge werden übersprungen, nichts wirft", () => {
    const acc: Acc = new Map();
    mapSteps({ rollupDataPoints: [{}, { civilStartTime: { date: { year: 2026, month: 1, day: 1 } }, steps: { countSum: "abc" } }, null] }, acc);
    mapWeight({ dataPoints: [{ weight: { weightGrams: -5, sampleTime: { physicalTime: "x" } } }, {}] }, acc);
    mapRestingHr(undefined, acc);
    mapSleep("kaputt", acc);
    expect(acc.size).toBe(0);
    expect(mapExercise({ dataPoints: [{ exercise: {} }] }, (s) => s)).toEqual([]);
  });
  it("Hilfsfunktionen", () => {
    expect(civilDate({ date: { year: 2026, month: 3, day: 5 } })).toBe("2026-03-05");
    expect(civilDate({ year: 2026, month: 3, day: 5 })).toBe("2026-03-05");
    expect(civilDate({})).toBeNull();
    expect(durationSeconds("3900s")).toBe(3900);
    expect(durationSeconds("12.5s")).toBe(12.5);
    expect(durationSeconds("1h")).toBeNull();
    // Sommerzeit: 22:30 UTC am 28.6. ist 00:30 am 29.6. in Zürich (UTC+2)
    expect(zurichDay("2026-06-28T22:30:00Z")).toBe("2026-06-29");
    expect(zurichDay("2026-06-28T21:30:00Z")).toBe("2026-06-28");
  });
});
