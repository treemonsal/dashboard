import { describe, expect, it } from "vitest";
import { monthlyCount as mc, depositsAfter, depotSplit, lotsBySymbol, nextWeekday, parseSplit, planBuys, validBuys, depotHoldings, portfolioProduct, planPortfolioValues, depositedAt, depotState, monthlyCount, planValues, type Close, type DepotConfig, type DepotEntry } from "../src/shared/depot";

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
  it("monatliche Einzahlung zählt ab dem ersten Stichtag nach dem Startbestand", () => {
    expect(monthlyCount("2026-11-14", "2026-11-24", 25)).toBe(0);
    expect(monthlyCount("2026-11-14", "2026-11-30", 25)).toBe(1);
    expect(monthlyCount("2026-11-14", "2026-12-24", 25)).toBe(1);
    expect(monthlyCount("2026-11-14", "2026-12-25", 25)).toBe(2);
    expect(monthlyCount("2026-11-14", "2027-02-25", 25)).toBe(4);
    // Start nach dem Stichtag: erst der Folgemonat
    expect(monthlyCount("2026-11-26", "2026-12-24", 25)).toBe(0);
    // Jahreswechsel und kurzer Monat
    expect(monthlyCount("2026-12-30", "2027-02-28", 31)).toBe(3);
    expect(depositedAt([val("2026-11-14", 3175)], rules, "2027-01-31")).toBe(3175 + 3 * 350);
  });
  it("Gewinn rechnet mit den Einzahlungen bis zum Datum des Werts, nicht bis heute", () => {
    const s = depotState([val("2026-11-14", 3000), val("2026-12-26", 3400)], rules);
    expect(s.deposited).toBe(3700);
    expect(s.gain).toBe(-300);
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


describe("Sparplan: Käufe aus Einzahlungen", () => {
  const split = depotSplit({});
  const c = (rows: [string, number][]): Close[] => rows.map(([date, close]) => ({ date, close }));
  const base = [val("2026-11-26", 3000)];
  const buy = (entries: DepotEntry[], today: string, closes: Record<string, Close[]>, have = new Set<string>(), fx = c([["2026-11-01", 0.9]])) =>
    planBuys({ deposits: depositsAfter(entries, rules, today), split, have, closes, fx, today });

  it("Aufteilung: Standard 50/50, nur bekannte Symbole, Summe 100", () => {
    expect(depotSplit({})).toEqual([{ symbol: "VUAA", pct: 50 }, { symbol: "XNAS", pct: 50 }]);
    expect(depotSplit({ investSplit: "kaputt" })).toEqual(depotSplit({}));
    expect(parseSplit('[{"symbol":"VUAA","pct":70},{"symbol":"XNAS","pct":30}]')).toHaveLength(2);
    expect(parseSplit('[{"symbol":"VUAA","pct":100}]')).toHaveLength(1);
    expect(parseSplit('[{"symbol":"VUAA","pct":60},{"symbol":"XNAS","pct":30}]')).toBeNull();
    expect(parseSplit('[{"symbol":"FOO","pct":100}]')).toBeNull();
    expect(parseSplit('[{"symbol":"VUAA","pct":50},{"symbol":"VUAA","pct":50}]')).toBeNull();
    expect(parseSplit("[]")).toBeNull();
  });
  it("Monatsrate am Stichtag: 175 je Symbol zum Kurs des Tages mal EUR/CHF", () => {
    const closes = { VUAA: c([["2026-12-25", 100]]), XNAS: c([["2026-12-25", 50]]) };
    const b = buy(base, "2026-12-25", closes);
    expect(b.map((x) => [x.depositKey, x.symbol, x.chf, x.shares, x.buyDate, x.late])).toEqual([
      ["m:2026-12", "VUAA", 175, 175 / 90, "2026-12-25", false],
      ["m:2026-12", "XNAS", 175, 175 / 45, "2026-12-25", false],
    ].map((r) => [r[0], r[1], r[2], Math.round((r[3] as number) * 1e6) / 1e6, r[4], r[5]]));
    // vor dem Stichtag nichts
    expect(buy(base, "2026-12-24", closes)).toEqual([]);
  });
  it("Zusatz-Einzahlung von Hand geht ebenfalls 50/50", () => {
    const entries = [...base, { ...dep("2026-11-30", 100), id: "z1" }];
    const b = buy(entries, "2026-11-30", { VUAA: c([["2026-11-30", 90]]), XNAS: c([["2026-11-30", 45]]) });
    expect(b.map((x) => [x.depositKey, x.symbol, x.chf])).toEqual([["d:z1", "VUAA", 50], ["d:z1", "XNAS", 50]]);
    expect(b[0]!.shares).toBeCloseTo(50 / (90 * 0.9), 6);
  });
  it("Wochenende: Kauf erst am Montag, nicht verspätet", () => {
    const entries = [...base, { ...dep("2026-11-28", 100), id: "w" }]; // Samstag
    expect(nextWeekday("2026-11-28")).toBe("2026-11-30");
    expect(buy(entries, "2026-11-28", { VUAA: c([["2026-11-27", 100]]), XNAS: c([["2026-11-27", 50]]) })).toEqual([]);
    const b = buy(entries, "2026-11-30", { VUAA: c([["2026-11-30", 100]]), XNAS: c([["2026-11-30", 50]]) });
    expect(b.map((x) => [x.buyDate, x.late])).toEqual([["2026-11-30", false], ["2026-11-30", false]]);
  });
  it("Kurs erst später verfügbar: erster Kurs danach, als verspätet markiert", () => {
    const b = buy(base, "2026-12-29", { VUAA: c([["2026-12-29", 100]]), XNAS: c([["2026-12-29", 50]]) });
    expect(b.map((x) => [x.buyDate, x.late])).toEqual([["2026-12-29", true], ["2026-12-29", true]]);
  });
  it("fehlender Kurs oder Wechselkurs: kein Kauf, kein erfundener Kurs, andere Symbole laufen", () => {
    const only = buy(base, "2026-12-25", { VUAA: c([["2026-12-25", 100]]) });
    expect(only.map((x) => x.symbol)).toEqual(["VUAA"]);
    expect(planBuys({ deposits: depositsAfter(base, rules, "2026-12-25"), split, have: new Set(), closes: { VUAA: c([["2026-12-25", 100]]) }, fx: null, today: "2026-12-25" })).toEqual([]);
    // Kurs vor der Einzahlung zählt nicht
    expect(buy(base, "2026-12-25", { VUAA: c([["2026-12-24", 100]]), XNAS: [] })).toEqual([]);
  });
  it("kein Doppel: schon gekaufte Einzahlung und Symbol werden übersprungen", () => {
    const closes = { VUAA: c([["2026-12-25", 100]]), XNAS: c([["2026-12-25", 50]]) };
    const b = buy(base, "2026-12-25", closes, new Set(["m:2026-12|VUAA"]));
    expect(b.map((x) => x.symbol)).toEqual(["XNAS"]);
    expect(buy(base, "2026-12-25", closes, new Set(["m:2026-12|VUAA", "m:2026-12|XNAS"]))).toEqual([]);
  });
  it("neuer Handwert setzt die Basis zurück: frühere Einzahlungen und Käufe zählen nicht mehr", () => {
    const entries = [...base, { ...dep("2026-11-30", 100), id: "z" }, val("2027-01-10", 3900)];
    expect(depositsAfter(entries, rules, "2027-01-10")).toEqual([]);
    const old = [{ depositKey: "m:2026-12", symbol: "VUAA", buyDate: "2026-12-25", shares: 1 }];
    expect(validBuys(old, depositsAfter(entries, rules, "2027-01-10"))).toEqual([]);
    // danach zählt erst die nächste Rate
    expect(depositsAfter(entries, rules, "2027-01-25").map((d) => d.key)).toEqual(["m:2027-01"]);
    // gelöschte Zusatz-Einzahlung: ihr Kauf zählt nicht mehr
    expect(validBuys([{ depositKey: "d:weg", symbol: "VUAA", buyDate: "2026-11-30", shares: 1 }], depositsAfter(base, rules, "2026-12-01"))).toEqual([]);
  });
  it("Einzahlung am Tag des Handwerts ist im Handwert enthalten", () => {
    expect(depositsAfter([...base, { ...dep("2026-11-14", 50), id: "g" }], rules, "2026-11-20")).toEqual([]);
  });
  it("Gewinn springt am Kauftag nicht (bis auf Rundung)", () => {
    const entries: DepotEntry[] = [val("2026-11-14", 3000), val("2026-12-24", 3600)];
    const hold = { currency: "EUR" as const };
    const ph = (symbol: string, shares: number) => ({ symbol, shares, ...hold });
    const closes = { VUAA: c([["2026-12-24", 100], ["2026-12-28", 100]]), XNAS: c([["2026-12-24", 50], ["2026-12-28", 50]]) };
    const fx = c([["2026-12-01", 0.9]]);
    const deposits = depositsAfter(entries, rules, "2026-12-28");
    const buys = planBuys({ deposits, split, have: new Set(), closes: { VUAA: closes.VUAA!.slice(1), XNAS: closes.XNAS!.slice(1) }, fx, today: "2026-12-28" });
    const lots = lotsBySymbol(buys);
    const vals = planPortfolioValues({ entries, today: "2026-12-28", positions: [
      { config: ph("VUAA", 20), held: closes.VUAA!, fx, lots: lots.VUAA },
      { config: ph("XNAS", 40), held: closes.XNAS!, fx, lots: lots.XNAS },
    ] });
    expect(vals).toHaveLength(1);
    // Wert vor dem Kauf: 20*100*0.9 + 40*50*0.9 = 3600; danach plus 350 Franken Käufe zu gleichem Kurs
    expect(vals[0]!.amount).toBeCloseTo(3600 + 350, 1);
    const st = depotState([val("2026-11-14", 3000), val("2026-12-24", 3600), { kind: "value", date: "2026-12-28", amount: vals[0]!.amount, estimated: false, auto: true }], rules);
    expect(Math.abs(st.latest!.gain - st.series.at(-2)!.gain)).toBeLessThan(0.05);
  });
});

describe("erste Monatsrate im Startmonat", () => {
  it("Start 14.11., Stichtag 25.: Rate am 25.11. zählt", () => {
    expect(mc("2026-11-14", "2026-11-24", 25)).toBe(0);
    expect(mc("2026-11-14", "2026-11-25", 25)).toBe(1);
    expect(mc("2026-11-14", "2026-12-25", 25)).toBe(2);
  });
  it("Start am oder nach dem Stichtag: erst Folgemonat", () => {
    expect(mc("2026-11-25", "2026-11-30", 25)).toBe(0);
    expect(mc("2026-11-26", "2026-12-25", 25)).toBe(1);
  });
});
