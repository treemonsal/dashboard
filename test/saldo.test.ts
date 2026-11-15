import { describe, expect, it } from "vitest";
import { entryCurrent, saldoAbgleich, type SaldoAnker, type SaldoBuchung, type SaldoEingabe } from "../src/shared/saldo";

const anchor: SaldoAnker = { balance: 200, day: "2026-10-31", kind: "auszug" };
const b = (date: string, amount: number, createdAt = `${date}T08:00:00Z`, provisional = true): SaldoBuchung => ({ date, amount, createdAt, provisional });
const entry = (balance: number, day = "2026-11-15", at = "2026-11-15T12:00:00Z"): SaldoEingabe => ({ balance, day, at });

describe("saldoAbgleich", () => {
  it("ohne Anker keine Rechnung", () => {
    expect(saldoAbgleich(null, entry(100), []).state).toBe("kein-anker");
  });
  it("ohne Eingabe keine Differenz", () => {
    const r = saldoAbgleich(anchor, null, [b("2026-11-02", -10)]);
    expect(r).toMatchObject({ state: "keine-eingabe", unrecorded: 0, diff: 0 });
  });
  it("stimmt: Anker plus Buchungen seither gleich Eingabe", () => {
    const r = saldoAbgleich(anchor, entry(180), [b("2026-11-02", -12.5), b("2026-11-05", -7.5)]);
    expect(r).toMatchObject({ state: "stimmt", expected: 180, diff: 0, unrecorded: 0 });
  });
  it("weniger da als gebucht: Differenz wird zu nicht erfasst", () => {
    const r = saldoAbgleich(anchor, entry(150), [b("2026-11-02", -12.5)]);
    expect(r).toMatchObject({ state: "differenz", expected: 187.5, diff: -37.5, unrecorded: 37.5 });
  });
  it("mehr da als gebucht: Differenz sichtbar, aber nichts wird abgezogen", () => {
    const r = saldoAbgleich(anchor, entry(250), []);
    expect(r).toMatchObject({ state: "differenz", diff: 50, unrecorded: 0 });
  });
  it("bestätigte Buchungen bis zum Ankertag sind im Saldo schon enthalten", () => {
    const r = saldoAbgleich(anchor, entry(190), [b("2026-10-31", -40, "2026-11-01T00:00:00Z", false), b("2026-11-03", -10, "2026-11-03T00:00:00Z", false)]);
    expect(r.expected).toBe(190);
  });
  it("vorläufige zählen auch mit Datum vor dem Anker (nicht im Auszug)", () => {
    const r = saldoAbgleich(anchor, entry(190), [b("2026-10-20", -10)]);
    expect(r.expected).toBe(190);
  });
  it("Buchungen nach dem Tag der Eingabe und später am selben Tag angelegte zählen nicht", () => {
    const r = saldoAbgleich(anchor, entry(180), [b("2026-11-02", -20), b("2026-11-15", -5, "2026-11-15T13:00:00Z"), b("2026-11-16", -9)]);
    expect(r).toMatchObject({ expected: 180, state: "stimmt" });
  });
  it("eine nachgetragene Buchung mit früherem Datum erklärt die Differenz", () => {
    const e = entry(150);
    expect(saldoAbgleich(anchor, e, []).unrecorded).toBe(50);
    expect(saldoAbgleich(anchor, e, [b("2026-11-10", -50, "2026-11-15T14:00:00Z")]).unrecorded).toBe(0);
  });
  it("Rundung: Rappen-Summen ohne Gleitkommafehler", () => {
    const r = saldoAbgleich({ ...anchor, balance: 0.3 }, entry(0), [b("2026-11-02", -0.1), b("2026-11-03", -0.2)]);
    expect(r.state).toBe("stimmt");
  });
  it("Anker aus erster Eingabe: spätere Buchungen zählen ab dem Zeitpunkt", () => {
    const a: SaldoAnker = { balance: 100, day: "2026-11-10", kind: "eingabe", at: "2026-11-10T10:00:00Z" };
    const rows = [b("2026-11-09", -30, "2026-11-10T09:00:00Z"), b("2026-11-10", -5, "2026-11-10T09:30:00Z"), b("2026-11-10", -4, "2026-11-10T11:00:00Z"), b("2026-11-12", -6)];
    expect(saldoAbgleich(a, entry(80), rows)).toMatchObject({ expected: 90, diff: -10, unrecorded: 10 });
  });
  it("die Eingabe, die den Anker gesetzt hat, ist keine eigene Eingabe", () => {
    const a: SaldoAnker = { balance: 100, day: "2026-11-10", kind: "eingabe", at: "2026-11-10T10:00:00Z" };
    expect(saldoAbgleich(a, { balance: 100, day: "2026-11-10", at: "2026-11-10T10:00:00Z" }, []).state).toBe("keine-eingabe");
  });
});

describe("entryCurrent", () => {
  it("ein jüngerer Auszug macht die Eingabe überholt", () => {
    expect(entryCurrent({ balance: 1, day: "2026-11-30", kind: "auszug" }, entry(1))).toBe(false);
    expect(entryCurrent({ balance: 1, day: "2026-10-31", kind: "auszug" }, entry(1))).toBe(true);
    expect(entryCurrent(null, entry(1))).toBe(true);
    expect(entryCurrent(null, null)).toBe(false);
  });
});
