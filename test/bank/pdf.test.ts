import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, applyCategories, dedupe, groupLines, matchDate, mealShares, monthSummary, parsePdf, pdfText, rowsToResult, type PdfItem, type PdfLine } from "../../src/shared/bank";

/* Erfundene Zeilen. Zellen: [x, x2, Text]. Zahlen stehen rechtsbündig unter ihrer Überschrift. */
type C = [number, number, string];
let y = 800;
const line = (page: number, cells: C[]): PdfLine => {
  y -= 14;
  const cs = cells.map(([x, x2, text]) => ({ x, x2, text }));
  return { page, y, cells: cs, text: cs.map((c) => c.text).join(" ") };
};
const num = (x2: number, text: string): C => [x2 - text.length * 5, x2, text];
// Spalten (rechte Kante): Ausgehend 390, Eingehend 460, Saldo 540
const OUT = 390, IN = 460, BAL = 540;
const hdrDe = (p: number) => line(p, [[40, 70, "Datum"], [120, 200, "Beschreibung"], [340, 390, "Ausgehend"], [410, 460, "Eingehend"], [505, 540, "Saldo"]]);
const hdrEn = (p: number) => line(p, [[40, 70, "Date"], [120, 200, "Description"], [335, 390, "Money out"], [415, 460, "Money in"], [495, 540, "Balance"]]);
const tx = (p: number, date: string, desc: string, o: { out?: string; in?: string; bal?: string }): PdfLine =>
  line(p, [[40, 40 + date.length * 5, date], [120, 120 + desc.length * 5, desc], ...(o.out ? [num(OUT, o.out)] : []), ...(o.in ? [num(IN, o.in)] : []), ...(o.bal ? [num(BAL, o.bal)] : [])]);
const txt = (p: number, text: string): PdfLine => line(p, [[120, 120 + text.length * 5, text]]);
const reset = () => { y = 800; };

describe("matchDate", () => {
  it.each([
    ["01.10.2026 Migros", "2026-10-01", 10],
    ["1. Okt. 2026", "2026-10-01", 12],
    ["1. Oktober 2026 x", "2026-10-01", 15],
    ["01 Oct 2026", "2026-10-01", 11],
    ["Oct 1, 2026", "2026-10-01", 11],
    ["3. Mär. 2026", "2026-03-03", 12],
    ["2026-10-01", "2026-10-01", 10],
    ["31 Dez 2026", "2026-12-31", 11],
  ])("%s", (s, d, len) => expect(matchDate(s)).toEqual({ date: d, len }));
  it.each(["31.02.2026", "Datum", "12.50", "1. Foo 2026", "2026"])("kein Datum: %s", (s) => expect(matchDate(s)).toBeNull());
});

describe("groupLines", () => {
  const it_ = (page: number, x: number, y_: number, text: string, w = text.length * 5): PdfItem => ({ page, x, y: y_, w, text });
  it("gleiche y-Lage ist eine Zeile, Wörter nah beieinander eine Zelle, grosse Lücke trennt Spalten", () => {
    const lines = groupLines([
      it_(1, 200, 700.4, "Coop"), it_(1, 40, 700, "01.10.2026"), it_(1, 225, 699.2, "Pronto"), it_(1, 400, 700, "12.50"),
      it_(1, 40, 686, "02.10.2026"), it_(2, 40, 700, "Seite 2"),
    ]);
    expect(lines.map((l) => l.cells.map((c) => c.text))).toEqual([["01.10.2026", "Coop Pronto", "12.50"], ["02.10.2026"], ["Seite 2"]]);
    expect(lines.map((l) => l.page)).toEqual([1, 1, 2]);
  });
  it("pdfText gibt Positionen mit aus", () => {
    expect(pdfText(groupLines([it_(1, 40, 700, "Hallo")]))).toContain("[40-65] Hallo");
  });
});

describe("parsePdf: Revolut deutsch, Ausgehend/Eingehend, mehrzeilig, Seitenumbruch", () => {
  reset();
  const lines = [
    txt(1, "Revolut Bank UAB"), txt(1, "Kontoauszug"), txt(1, "IBAN CH93 0076 2011 6238 5295 7"),
    line(1, [[40, 150, "Anfangssaldo"], num(BAL, "1'000.00")]),
    hdrDe(1),
    tx(1, "1. Okt. 2026", "Migros Zürich", { out: "12.50", bal: "987.50" }),
    txt(1, "Karte: 1234 ****"),
    tx(1, "2. Okt. 2026", "Twint Mami", { in: "25.00", bal: "1'012.50" }),
    txt(1, "Seite 1 von 2"),
    txt(2, "Revolut Bank UAB"),
    hdrDe(2),
    tx(2, "3. Okt. 2026", "Restaurant Sonne", { out: "30.00", bal: "982.50" }),
    txt(2, "Zürich"),
    line(2, [[40, 100, "Total"], num(OUT, "42.50"), num(IN, "25.00")]),
  ];
  const r = parsePdf(lines);
  it("liest alle Buchungen mit Vorzeichen, Saldo und mehrzeiliger Beschreibung", () => {
    expect(r.rows.map((x) => [x.date, x.description, x.amount, x.balance])).toEqual([
      ["2026-10-01", "Migros Zürich Karte: 1234 ****", -1250, 98750],
      ["2026-10-02", "Twint Mami", 2500, 101250],
      ["2026-10-03", "Restaurant Sonne Zürich", -3000, 98250],
    ]);
    expect(r.bank).toBe("revolut");
    expect(r.account).toBe("CH9300762011623852957");
    expect(r.uncertain).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.stats).toMatchObject({ dated: 3, recognized: 3, chainBreaks: 0 });
  });
  it("Hashes und Format wie bei CSV: Dedupe, Kategorien, Mahlzeiten, Monatsauswertung greifen", () => {
    expect(r.rows.every((x) => x.hash.length > 10 && x.currency === "CHF" && x.amountChf === x.amount)).toBe(true);
    const again = parsePdf(lines);
    expect(dedupe(r.rows.map((x) => x.hash), again.rows).fresh).toHaveLength(0);
    const cat = applyCategories(r.rows, DEFAULT_RULES);
    expect(cat[0]!.category).toBeTruthy();
    const withMeal = r.rows.map((x) => (x.description.startsWith("Restaurant") ? { ...x, amount: -3000, amountChf: -3000, category: "Gastronomie" } : x));
    const meals = mealShares(withMeal, { payerName: "Mami", minMealRappen: 1000 });
    expect(meals.openMeals.length + meals.settled.length).toBeGreaterThan(0);
    // Migros 12.50 voll, Restaurant 30.00 zur Hälfte (Mutter zahlt 15.00 zurück): eigener Anteil 27.50, Eingang Mami zählt nicht als Einnahme
    const sum = monthSummary(withMeal, "2026-10", 30000, { today: "2026-10-31", payerName: "Mami" });
    expect(sum.spent).toBe(2750);
    expect(sum.income).toBe(0);
  });
});

describe("parsePdf: Revolut englisch", () => {
  it("Money out / Money in / Balance, 01 Oct 2026", () => {
    reset();
    const r = parsePdf([
      txt(1, "Revolut Ltd"), hdrEn(1),
      tx(1, "01 Oct 2026", "Coop Pronto", { out: "9.80", bal: "490.20" }),
      tx(1, "02 Oct 2026", "Salary", { in: "650.00", bal: "1'140.20" }),
      tx(1, "05 Oct 2026", "SBB Mobile", { out: "18.00", bal: "1'122.20" }),
    ]);
    expect(r.rows.map((x) => [x.date, x.amount])).toEqual([["2026-10-01", -980], ["2026-10-02", 65000], ["2026-10-05", -1800]]);
    expect(r.uncertain).toBe(0);
  });
});

describe("parsePdf: eine Betragsspalte mit Vorzeichen und Saldo (ZKB-artig, 01.10.2026)", () => {
  it("Datum, Text, Betrag, Saldo", () => {
    reset();
    const r = parsePdf([
      line(1, [[40, 70, "Datum"], [100, 160, "Buchungstext"], [380, 420, "Betrag"], [490, 540, "Saldo"]]),
      line(1, [[40, 90, "01.10.2026"], [100, 180, "Denner"], num(420, "-15.30"), num(BAL, "2'000.00")]),
      line(1, [[40, 90, "03.10.2026"], [100, 200, "Gutschrift Lohn"], num(420, "650.00"), num(BAL, "2'650.00")]),
    ]);
    expect(r.rows.map((x) => x.amount)).toEqual([-1530, 65000]);
    expect(r.uncertain).toBe(0);
  });
});

describe("parsePdf: ohne Saldo", () => {
  it("Spalten Ausgehend/Eingehend geben das Vorzeichen, Hinweis ohne Kette, nicht blockierend", () => {
    reset();
    const r = parsePdf([hdrDe(1), tx(1, "1. Okt. 2026", "Kiosk", { out: "4.50" }), tx(1, "2. Okt. 2026", "Twint", { in: "10.00" })]);
    expect(r.rows.map((x) => x.amount)).toEqual([-450, 1000]);
    expect(r.uncertain).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/Kein Saldo/);
  });
  it("ohne Spalten, ohne Vorzeichen und ohne Saldo ist das Vorzeichen unsicher: Warnung, Bestätigung nötig", () => {
    reset();
    const r = parsePdf([line(1, [[40, 90, "01.10.2026"], [120, 170, "Kiosk"], num(400, "4.50")]), line(1, [[40, 90, "02.10.2026"], [120, 170, "Twint"], num(400, "10.00")])]);
    expect(r.rows).toHaveLength(2);
    expect(r.uncertain).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toMatch(/Vorzeichen/);
  });
  it("ohne Spalten: Vorzeichen aus der Saldo-Differenz", () => {
    reset();
    const r = parsePdf([
      line(1, [[40, 150, "Saldo zu Beginn"], num(BAL, "100.00")]),
      line(1, [[40, 90, "01.10.2026"], [120, 170, "Kiosk"], num(420, "4.50"), num(BAL, "95.50")]),
      line(1, [[40, 90, "02.10.2026"], [120, 170, "Twint"], num(420, "10.00"), num(BAL, "105.50")]),
    ]);
    expect(r.rows.map((x) => x.amount)).toEqual([-450, 1000]);
    expect(r.uncertain).toBe(0);
  });
});

describe("parsePdf: neueste zuerst", () => {
  it("dreht die Reihenfolge anhand der Saldo-Kette und liefert aufsteigend", () => {
    reset();
    const r = parsePdf([
      hdrDe(1),
      tx(1, "3. Okt. 2026", "C", { out: "10.00", bal: "70.00" }),
      tx(1, "2. Okt. 2026", "B", { out: "20.00", bal: "80.00" }),
      tx(1, "1. Okt. 2026", "A", { in: "100.00", bal: "100.00" }),
    ]);
    expect(r.rows.map((x) => [x.description, x.amount])).toEqual([["A", 10000], ["B", -2000], ["C", -1000]]);
    expect(r.uncertain).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/gedreht/);
  });
});

describe("parsePdf: Warnungen statt Raten", () => {
  it("falsche Saldo-Kette: Warnung mit Zahl, uncertain > 0", () => {
    reset();
    const r = parsePdf([
      hdrDe(1),
      tx(1, "1. Okt. 2026", "A", { out: "10.00", bal: "90.00" }),
      tx(1, "2. Okt. 2026", "B", { out: "10.00", bal: "70.00" }),
      tx(1, "3. Okt. 2026", "C", { out: "10.00", bal: "60.00" }),
    ]);
    expect(r.stats.chainBreaks).toBe(1);
    expect(r.uncertain).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toMatch(/Saldo-Kette stimmt bei 1 von 2/);
  });
  it("weniger als 80 Prozent der Zeilen mit Datum erkannt", () => {
    reset();
    const r = parsePdf([
      hdrDe(1),
      tx(1, "1. Okt. 2026", "A", { out: "10.00", bal: "90.00" }),
      line(1, [[40, 90, "02.10.2026"], [120, 200, "ohne Betrag"]]),
      line(1, [[40, 90, "03.10.2026"], [120, 200, "auch ohne"]]),
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.stats).toMatchObject({ dated: 3, recognized: 1 });
    expect(r.uncertain).toBe(2);
    expect(r.warnings.join(" ")).toMatch(/Nur 1 von 3 Zeilen/);
  });
  it("kein Datum im PDF: Warnung, keine Buchungen", () => {
    reset();
    const r = parsePdf([txt(1, "Irgendein Text"), txt(1, "Noch einer")]);
    expect(r.rows).toEqual([]);
    expect(r.uncertain).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toMatch(/keine Zeile mit Datum/);
    expect(parsePdf([]).uncertain).toBeGreaterThan(0);
  });
  it("Fremdwährung ohne Kurs: geschätzt und Warnung; mit Kurs umgerechnet", () => {
    reset();
    const l = [hdrDe(1), line(1, [[40, 90, "1. Okt. 2026"], [120, 170, "Hotel"], num(OUT, "EUR 100.00"), num(BAL, "900.00")])];
    const a = parsePdf(l);
    expect(a.rows[0]).toMatchObject({ currency: "EUR", amount: -10000, amountChf: -10000, chfEstimated: true });
    expect(a.warnings.join(" ")).toMatch(/Kein Kurs für EUR/);
    expect(parsePdf(l, { rates: { EUR: 0.95 } }).rows[0]!.amountChf).toBe(-9500);
  });
  it("Nummern ohne Dezimalstellen (Referenz, Hausnummer) sind nie ein Betrag", () => {
    reset();
    const r = parsePdf([hdrDe(1), line(1, [[40, 90, "1. Okt. 2026"], [120, 260, "Bahnhofstrasse 12"], [270, 300, "4567"], num(OUT, "7.00"), num(BAL, "93.00")])]);
    expect(r.rows[0]).toMatchObject({ amount: -700, description: "Bahnhofstrasse 12 4567" });
  });
});

describe("rowsToResult (Server)", () => {
  it("setzt Konto und Hash selbst, gleich wie parsePdf mit demselben Konto", () => {
    reset();
    const r = parsePdf([hdrDe(1), tx(1, "1. Okt. 2026", "A", { out: "10.00", bal: "90.00" }), tx(1, "1. Okt. 2026", "A", { out: "10.00", bal: "80.00" })]);
    const back = rowsToResult({ bank: r.bank, account: r.account, rows: r.rows.map(({ date, description, amount, currency, amountChf, balance }) => ({ date, description, amount, currency, amountChf, balance })) });
    expect(back.rows.map((x) => x.hash)).toEqual(r.rows.map((x) => x.hash));
    expect(new Set(back.rows.map((x) => x.hash)).size).toBe(2);
  });
});
