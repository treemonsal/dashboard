import { describe, expect, it } from "vitest";
import { depotHoldings, portfolioProduct, planPortfolioValues, depositedAt, depotState, monthlyCount, planValues, type Close, type DepotConfig, type DepotEntry } from "../src/shared/depot";

const rules = { monthly: 350, day: 25 };
const val = (date: string, amount: number, estimated = false): DepotEntry => ({ kind: "value", date, amount, estimated });
const dep = (date: string, amount: number): DepotEntry => ({ kind: "deposit", date, amount });

describe("Depot: Startbestand und Gewinn", () => {
  it("der erste Wert ist Startbestand: einbezahlt voll, Gewinn 0, kein Plus am ersten Tag", () => {
    const s = depotState([val("2026-11-14", 3175)], rules);
    expect(s.latest?.value).toBe(3175);
    expect(s.deposited).toBe(3175);
    expect(s.gain).toBe(0);
    expect(s.pct).toBe(0);
  });
  it("ohne Eintrag: nichts", () => {
    const s = depotState([], rules);
    expect(s.latest).toBeNull();
    expect(s.gain).toBeNull();
    expect(s.pct).toBeNull();
  });
  it("Gewinn erst ab dem zweiten Wert, in Franken und Prozent", () => {
    const s = depotState([val("2026-11-14", 3000), val("2026-11-20", 3150)], rules);
    expect(s.deposited).toBe(3000);
    expect(s.gain).toBe(150);
    expect(s.pct).toBe(5);
    const v = depotState([val("2026-11-14", 3000), val("2026-11-20", 2850)], rules);
    expect(v.gain).toBe(-150);
    expect(v.pct).toBe(-5);
  });
  it("monatliche Einzahlung zählt ab dem Monat nach dem Startbestand, am Stichtag", () => {
    expect(monthlyCount("2026-11-14", "2026-11-30", 25)).toBe(0);
    expect(monthlyCount("2026-11-14", "2026-12-24", 25)).toBe(0);
    expect(monthlyCount("2026-11-14", "2026-12-25", 25)).toBe(1);
    expect(monthlyCount("2026-11-14", "2027-02-25", 25)).toBe(3);
    // Jahreswechsel und kurzer Monat
    expect(monthlyCount("2026-12-30", "2027-02-28", 31)).toBe(2);
    expect(depositedAt([val("2026-11-14", 3175)], rules, "2027-01-31")).toBe(3175 + 2 * 350);
  });
  it("Gewinn rechnet mit den Einzahlungen bis zum Datum des Werts, nicht bis heute", () => {
    const s = depotState([val("2026-11-14", 3000), val("2026-12-26", 3400)], rules);
    expect(s.deposited).toBe(3350);
    expect(s.gain).toBe(50);
  });
  it("Einzahlungen von Hand zählen nur nach dem Startbestand", () => {
    const entries = [val("2026-11-14", 3000), dep("2026-11-10", 999), dep("2026-11-14", 999), dep("2026-11-18", 200), val("2026-11-20", 3300)];
    const s = depotState(entries, rules);
    expect(s.deposited).toBe(3200);
    expect(s.gain).toBe(100);
  });
  it("ein Handwert verdrängt einen geschätzten vom selben Tag; geschätzte sind nie Startbestand", () => {
    const entries = [val("2026-11-12", 3000, true), val("2026-11-14", 3000), val("2026-11-20", 3100, true), val("2026-11-20", 3120)];
    const s = depotState(entries, rules);
    expect(s.start?.date).toBe("2026-11-14");
    expect(s.series.map((p) => [p.date, p.value, p.estimated])).toEqual([["2026-11-14", 3000, false], ["2026-11-20", 3120, false]]);
    expect(depotState([val("2026-11-14", 3000), val("2026-11-20", 3100, true)], rules).latest?.estimated).toBe(true);
  });
});

const closes = (rows: [string, number][]): Close[] => rows.map(([date, close]) => ({ date, close }));
const none: DepotConfig = { symbol: "", shares: 0, currency: "USD" };
// Freitag 13.11. ist ein Handelstag, 14./15.11. Wochenende.
const proxy = closes([["2026-11-12", 100], ["2026-11-13", 110], ["2026-11-16", 99], ["2026-11-17", 121]]);
const fx1 = closes([["2026-11-01", 1]]);

describe("Depot: Schätzung", () => {
  const base = { rules, config: none, proxy, proxyFx: fx1, held: [], heldFx: null };
  it("schreibt den letzten Handwert mit der Kursänderung des Vergleichs-ETF fort", () => {
    const r = planValues({ ...base, entries: [val("2026-11-12", 1000)], today: "2026-11-14" });
    expect(r).toEqual([{ date: "2026-11-13", amount: 1100, estimated: true }]);
  });
  it("Wochenende: ein am Samstag eingetragener Wert startet vom Freitagskurs, am Wochenende kommt nichts Neues", () => {
    const e = [val("2026-11-14", 1000)];
    expect(planValues({ ...base, entries: e, today: "2026-11-15" })).toEqual([]);
    const r = planValues({ ...base, entries: e, today: "2026-11-17" });
    expect(r).toEqual([{ date: "2026-11-16", amount: 900, estimated: true }, { date: "2026-11-17", amount: 1100, estimated: true }]);
  });
  it("Einzahlungen seit dem Handwert kommen dazu", () => {
    const e = [val("2026-11-12", 1000), dep("2026-11-16", 50)];
    const r = planValues({ ...base, entries: e, today: "2026-11-17" });
    expect(r.at(-1)).toEqual({ date: "2026-11-17", amount: 1260, estimated: true });
  });
  it("Wechselkurs wirkt mit", () => {
    const fx = closes([["2026-11-12", 0.8], ["2026-11-13", 0.88]]);
    const r = planValues({ ...base, proxyFx: fx, entries: [val("2026-11-12", 1000)], today: "2026-11-13" });
    expect(r).toEqual([{ date: "2026-11-13", amount: 1210, estimated: true }]);
  });
  it("fehlender Kurs oder Wechselkurs oder Handwert: kein neuer Wert", () => {
    expect(planValues({ ...base, proxy: [], entries: [val("2026-11-12", 1000)], today: "2026-11-17" })).toEqual([]);
    expect(planValues({ ...base, proxyFx: null, entries: [val("2026-11-12", 1000)], today: "2026-11-17" })).toEqual([]);
    expect(planValues({ ...base, entries: [], today: "2026-11-17" })).toEqual([]);
    // Kurse beginnen erst nach dem Handwert: keine Basis
    expect(planValues({ ...base, entries: [val("2026-11-01", 1000)], today: "2026-11-17" })).toEqual([]);
    expect(planValues({ ...base, proxy: closes([["2026-11-13", 0]]), entries: [val("2026-11-12", 1000)], today: "2026-11-17" })).toEqual([]);
  });
  it("geschätzte Werte sind nie die Basis", () => {
    const e = [val("2026-11-12", 1000), val("2026-11-13", 5000, true)];
    expect(planValues({ ...base, entries: e, today: "2026-11-13" })).toEqual([{ date: "2026-11-13", amount: 1100, estimated: true }]);
  });
});

describe("Depot: genaue Rechnung", () => {
  const held = closes([["2026-11-13", 50], ["2026-11-16", 40]]);
  const entries = [val("2026-11-12", 1000)];
  const o = { entries, rules, proxy, proxyFx: fx1, held, heldFx: closes([["2026-11-12", 0.5]]), today: "2026-11-17" };
  it("Anteile mal Kurs mal Wechselkurs, ohne Kennzeichnung geschätzt", () => {
    const r = planValues({ ...o, config: { symbol: "VOO", shares: 4, currency: "USD" } });
    expect(r).toEqual([{ date: "2026-11-13", amount: 100, estimated: false }, { date: "2026-11-16", amount: 80, estimated: false }]);
  });
  it("in Franken ohne Wechselkurs", () => {
    const r = planValues({ ...o, heldFx: null, config: { symbol: "CSSPX", shares: 2, currency: "CHF" } });
    expect(r.map((x) => x.amount)).toEqual([100, 80]);
  });
  it("Fremdwährung ohne Wechselkurs oder ohne Kurs: kein Wert, nie erfunden", () => {
    expect(planValues({ ...o, heldFx: null, config: { symbol: "VOO", shares: 4, currency: "USD" } })).toEqual([]);
    // Produkt konfiguriert, aber keine Kurse: keine Schätzung unterschieben
    expect(planValues({ ...o, held: [], config: { symbol: "VOO", shares: 4, currency: "USD" } }).every((x) => x.estimated)).toBe(true);
  });
});


describe("Mehrere ETF im Depot", () => {
  it("behält alte Einzelpositionen bei und liest beide neuen Positionen getrennt", () => {
    expect(depotHoldings({ investSymbol: "VOO", investShares: "2", investCurrency: "USD", investHoldings: "" })).toEqual([{ symbol: "VOO", shares: 2, currency: "USD", exchange: "US" }]);
    expect(depotHoldings({ investSymbol: "VOO", investShares: "2", investCurrency: "USD", investHoldings: JSON.stringify([{ symbol: "VUAA", shares: 2 }, { symbol: "XNAS", shares: 3 }]) })).toEqual([{ symbol: "VUAA", exchange: "TRADEGATE", shares: 2, currency: "EUR" }, { symbol: "XNAS", exchange: "TRADEGATE", shares: 3, currency: "EUR" }]);
  });
  it("nutzt bestätigte Mengen nur ohne bisherige Konfiguration", () => {
    expect(depotHoldings({ investSymbol: "", investShares: "", investCurrency: "USD" })).toEqual([
      { symbol: "VUAA", shares: 12.2, currency: "EUR", exchange: "TRADEGATE" },
      { symbol: "XNAS", shares: 23, currency: "EUR", exchange: "TRADEGATE" },
      { symbol: "NVDA", shares: 3, currency: "EUR", exchange: "TRADEGATE" },
    ]);
    expect(depotHoldings({ investSymbol: "VOO", investShares: "2", investCurrency: "USD", investHoldings: "[]" })).toEqual([]);
  });
  it("kennt die drei Wertpapiere eindeutig mit EUR Bewertungsquelle", () => {
    expect(portfolioProduct("VUAA")).toMatchObject({ isin: "IE00BFMXXD54", currency: "EUR", index: "S&P 500" });
    expect(portfolioProduct("XNAS")).toMatchObject({ isin: "IE00BMFKG444", currency: "EUR", index: "Nasdaq 100" });
    expect(portfolioProduct("NVDA")).toMatchObject({ isin: "US67066G1040", currency: "EUR" });
    expect(portfolioProduct("unknown")).toBeNull();
  });
  it("summiert beide ETF je gemeinsamem Kurstag mit der richtigen Umrechnung", () => {
    const r = planPortfolioValues({ entries: [val("2026-11-12", 1000)], today: "2026-11-17", positions: [
      { config: { symbol: "VUAA", shares: 2, currency: "USD" }, held: closes([["2026-11-13", 100], ["2026-11-16", 110]]), fx: closes([["2026-11-13", 0.8]]) },
      { config: { symbol: "XNAS", shares: 3, currency: "EUR" }, held: closes([["2026-11-13", 50], ["2026-11-17", 60]]), fx: closes([["2026-11-13", 0.9]]) },
    ] });
    expect(r).toEqual([{ date: "2026-11-13", amount: 295, estimated: false }]);
  });
  it("fehlender Kurs einer Position ergibt keinen Teilwert und keine SPY Schätzung", () => {
    expect(planPortfolioValues({ entries: [val("2026-11-12", 1000)], today: "2026-11-17", positions: [
      { config: { symbol: "VUAA", shares: 2, currency: "USD" }, held: closes([["2026-11-13", 100]]), fx: fx1 },
      { config: { symbol: "XNAS", shares: 3, currency: "CHF" }, held: [], fx: null },
    ] })).toEqual([]);
  });
  it("unvollständige oder beschädigte Konfiguration fällt nicht auf alte Position zurück", () => {
    const old = { investSymbol: "VOO", investShares: "2", investCurrency: "USD" };
    expect(depotHoldings({ ...old, investHoldings: "broken" })).toBeNull();
    expect(depotHoldings({ ...old, investHoldings: '[{"symbol":"VUAA","exchange":"","shares":0}]' })).toBeNull();
  });
});
