// Tests für die aus dem Live-Stand übertragenen Regeln (Zahlen, Datum, Kopfzeilen, zweizeilige Buchungen, Startsaldo).
// Alle Zeilen sind erfunden.
import { describe, expect, it } from "vitest";
import { parseAmount } from "../../src/shared/bank/num";
import { findHeader, groupLines, isDateOnly, matchDate, parsePdf, type PdfItem, type PdfLine } from "../../src/shared/bank/pdf";
import { pdfRows, importRequest } from "../../src/shared/schemas";

type C = [number, number, string];
let y = 800;
const line = (page: number, cells: C[]): PdfLine => {
  y -= 14;
  const cs = cells.map(([x, x2, text]) => ({ x, x2, text }));
  return { page, y, cells: cs, text: cs.map((c) => c.text).join(" ") };
};
const num = (x2: number, text: string): C => [x2 - text.length * 5, x2, text];

describe("parseAmount: Tausendergruppen", () => {
  it.each([
    ["1.234.567", 123456700],
    ["1,234,567", 123456700],
    ["12.345.678,90", 1234567890],
  ])("%s", (s, r) => expect(parseAmount(s)).toBe(r));
  it.each(["1.23.4", "12.3456.789", "1,23,4", "1234,567,8"])("lehnt unsaubere Gruppen ab: %s", (s) => expect(parseAmount(s)).toBeNull());
});

describe("pdfRows-Grenzen", () => {
  const row = { date: "2026-10-01", description: "x".repeat(1000), amount: -100, currency: "CHF", amountChf: -100 };
  it("Konto bis 100, Text bis 1000 Zeichen, Dateiname bis 500", () => {
    expect(pdfRows.safeParse({ bank: "yuh", account: "a".repeat(100), rows: [row] }).success).toBe(true);
    expect(pdfRows.safeParse({ bank: "yuh", account: "a".repeat(101), rows: [row] }).success).toBe(false);
    expect(pdfRows.safeParse({ bank: "yuh", rows: [{ ...row, description: "x".repeat(1001) }] }).success).toBe(false);
    expect(importRequest.safeParse({ files: [{ name: "n".repeat(500) }] }).success).toBe(true);
    expect(importRequest.safeParse({ files: [{ name: "n".repeat(501) }] }).success).toBe(false);
  });
});

describe("matchDate: neue Formate", () => {
  it.each([
    ["01/10/2026", "2026-10-01", 10],
    ["01.10.26 Coop", "2026-10-01", 8],
    ["1 févr. 2026", "2026-02-01", 12],
    ["3 août 2026", "2026-08-03", 11],
    ["12 déc 26", "2026-12-12", 9],
    ["1 gen 2026", "2026-01-01", 10],
    ["Oct 1, 26", "2026-10-01", 9],
  ])("%s", (s, d, len) => expect(matchDate(s)).toEqual({ date: d, len }));
  it.each(["01.10.1989", "01.10.2101", "01.10.26.5", "01.10.265"])("kein Datum: %s", (s) => expect(matchDate(s)).toBeNull());
  it("isDateOnly", () => {
    expect(isDateOnly(" 01.10.2026 ")).toBe(true);
    expect(isDateOnly("01.10.2026 Coop")).toBe(false);
    expect(isDateOnly("")).toBe(false);
  });
});

describe("groupLines: Datum und Betrag nicht mit Text verkleben", () => {
  const it_ = (x: number, text: string, w = text.length * 5): PdfItem => ({ page: 1, x, y: 700, w, text });
  it("trennt bei kleiner Lücke, hält Währung am Betrag", () => {
    const lines = groupLines([it_(40, "01.10.2026", 50), it_(92, "Coop"), it_(200, "CHF", 15), it_(217, "12.50", 25), it_(244, "Rest")]);
    expect(lines[0]!.cells.map((c) => c.text)).toEqual(["01.10.2026", "Coop", "CHF 12.50", "Rest"]);
  });
});

describe("findHeader", () => {
  it("dreiteilige Überschrift, Währungszusatz, Valuta als Datum", () => {
    const h = findHeader(line(1, [[40, 80, "Valuta"], [120, 140, "Art"], [142, 160, "der"], [162, 220, "Kontobewegung"], [340, 390, "Betrag (CHF)"], [500, 540, "Saldo in CHF"]]));
    expect(h?.map((a) => a.col)).toEqual(["date", "desc", "amount", "balance"]);
  });
  it("ohne Datum oder Text keine Kopfzeile", () => {
    expect(findHeader(line(1, [[340, 390, "Betrag"], [500, 540, "Saldo"]]))).toBeNull();
  });
});

describe("parsePdf: Live-Regeln", () => {
  const hdr = (p: number) => line(p, [[40, 70, "Datum"], [120, 200, "Text"], [340, 390, "Belastung"], [410, 460, "Gutschrift"], [505, 540, "Saldo"]]);
  it("Startsaldo aus Saldo-Tabelle (Wert unter der Überschrift), zweizeilige Buchung, Schlusssaldo ignoriert", () => {
    y = 800;
    const lines = [
      line(1, [[40, 200, "Konto Yuh Muster"]]),
      line(1, [[40, 120, "Eröffnungssaldo"], [300, 380, "Schlusssaldo"]]),
      line(1, [num(120, "100.00"), num(380, "77.50")]),
      hdr(1),
      line(1, [[40, 90, "01.10.2026"], [120, 180, "Bäckerei Muster"]]),
      line(1, [[120, 180, "Kartenzahlung"], num(390, "12.50"), num(540, "87.50")]),
      line(1, [[40, 90, "02.10.2026"], [120, 180, "Kiosk"], num(390, "10.00"), num(540, "77.50")]),
      line(1, [[40, 120, "Schlusssaldo"], num(540, "77.50")]),
    ];
    const r = parsePdf(lines, { fileName: "auszug.pdf" });
    expect(r.bank).toBe("yuh");
    expect(r.rows.map((x) => [x.date, x.description, x.amount, x.balance])).toEqual([
      ["2026-10-01", "Bäckerei Muster Kartenzahlung", -1250, 8750],
      ["2026-10-02", "Kiosk", -1000, 7750],
    ]);
    expect(r.stats).toMatchObject({ dated: 2, recognized: 2, chainBreaks: 0, chainChecked: 2 });
    expect(r.uncertain).toBe(0);
  });
  it("Bank aus dem Dateinamen, Datumszeile mit nur Saldo ist Startsaldo, Zeitraum ist keine Buchung", () => {
    y = 800;
    const lines = [
      line(1, [[40, 300, "01.10.2026 - 31.10.2026"]]),
      hdr(1),
      line(1, [[40, 90, "30.09.2026"], num(540, "50.00")]),
      line(1, [[40, 90, "03.10.2026"], [120, 180, "Lohn"], num(460, "650.00"), num(540, "700.00")]),
    ];
    const r = parsePdf(lines, { fileName: "zkb-oktober.pdf" });
    expect(r.bank).toBe("zkb");
    expect(r.rows.map((x) => [x.date, x.amount])).toEqual([["2026-10-03", 65000]]);
    expect(r.stats).toMatchObject({ dated: 1, chainChecked: 1, chainBreaks: 0 });
  });
  it("Startsaldo, der nicht zur ersten Buchung passt, wird verworfen", () => {
    y = 800;
    const lines = [
      hdr(1),
      line(1, [[40, 140, "Anfangssaldo"], num(540, "999.00")]),
      line(1, [[40, 90, "03.10.2026"], [120, 180, "Kiosk"], num(390, "5.00"), num(540, "45.00")]),
    ];
    const r = parsePdf(lines);
    expect(r.stats).toMatchObject({ chainChecked: 0, chainBreaks: 0 });
  });
  it("Datum, Text und Beträge in einer Zelle werden aufgetrennt", () => {
    y = 800;
    const lines = [line(1, [[40, 400, "05.10.2026 Migros Zürich 23.40 76.60"]])];
    const r = parsePdf(lines);
    expect(r.rows.map((x) => [x.date, x.description, x.amount, x.balance])).toEqual([["2026-10-05", "Migros Zürich", -2340, 7660]]);
  });
  it("Beschreibung wird auf 400 Zeichen begrenzt", () => {
    y = 800;
    const r = parsePdf([line(1, [[40, 90, "05.10.2026"], [120, 300, "x".repeat(600)], num(390, "1.00")])]);
    expect(r.rows[0]!.description.length).toBe(400);
  });
});
