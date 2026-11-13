import { describe, expect, it } from "vitest";
import { addDays, clusterAfterNext, dayMonthLong, dayShort, daysBetween, daysUntil, inDays, isoWeek, todayInZone, weekdayLong, zoneMidnightUtc } from "../src/shared/dates";

describe("todayInZone", () => {
  it("nimmt das Zürcher Datum, nicht UTC", () => {
    // 23:30 UTC im Winter ist in Zürich schon der nächste Tag
    expect(todayInZone(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-14");
    expect(todayInZone(new Date("2026-11-13T22:59:59Z"))).toBe("2026-11-13");
    // Sommerzeit: UTC+2
    expect(todayInZone(new Date("2026-06-30T22:00:00Z"))).toBe("2026-07-01");
    expect(todayInZone(new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
  });
});

describe("daysUntil (Tage bis Prüfung)", () => {
  const now = new Date("2026-11-13T09:00:00Z"); // Freitag, 13. November 2026
  it.each([
    ["2026-11-27", 14],
    ["2026-12-03", 20],
    ["2026-12-04", 21],
    ["2026-12-11", 28],
    ["2027-01-07", 55],
    ["2027-01-22", 70],
    ["2026-11-13", 0],
    ["2026-11-12", -1],
  ])("%s → %i", (date, n) => expect(daysUntil(date, now)).toBe(n));

  it("zählt kurz vor Mitternacht schon für den neuen Tag", () => {
    expect(daysUntil("2026-11-27", new Date("2026-11-13T23:10:00Z"))).toBe(13);
  });

  it("bleibt über den Sommerzeitwechsel ganzzahlig", () => {
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysUntil("2027-03-29", new Date("2027-03-27T23:30:00Z"))).toBe(1);
  });
});

describe("Hilfen", () => {
  it("formatiert Daten deutsch", () => {
    expect(weekdayLong("2026-11-13")).toBe("Freitag");
    expect(dayMonthLong("2026-11-13")).toBe("13. November");
    expect(dayShort("2026-12-03")).toBe("Do 3.12.");
    expect(dayShort("2027-01-07")).toBe("Do 7.1.");
  });
  it("rechnet Kalenderwochen und Tage", () => {
    expect(isoWeek("2026-11-13")).toBe(46);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(inDays(0)).toBe("heute");
    expect(inDays(1)).toBe("morgen");
    expect(inDays(14)).toBe("in 14 Tagen");
  });
  it("findet Mitternacht in Zürich als UTC", () => {
    expect(zoneMidnightUtc("2026-11-13")).toBe("2026-11-12T23:00:00.000Z");
    expect(zoneMidnightUtc("2026-07-01")).toBe("2026-06-30T22:00:00.000Z");
  });
  it("erkennt Prüfungshäufungen", () => {
    const ds = ["2026-11-27", "2026-12-03", "2026-12-04", "2026-12-11", "2027-01-07"].map((date) => ({ date }));
    expect(clusterAfterNext(ds)).toEqual({ count: 3, spanDays: 8 });
    expect(clusterAfterNext(ds.slice(0, 2))).toBeNull();
  });
});
