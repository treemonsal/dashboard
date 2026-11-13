import { describe, expect, it } from "vitest";
import { dedupe, guessColumns, parseExport, parseWithMapping } from "../../src/shared/bank";

const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-03-01 12:30:00,2026-03-02 08:00:00,Testmarkt Beispielstadt,-12.30,0.00,CHF,COMPLETED,987.70
CARD_PAYMENT,Current,2026-03-01 18:00:00,2026-03-01 18:00:01,Testmarkt Beispielstadt,-5.00,0.00,CHF,PENDING,
CARD_PAYMENT,Current,2026-03-03 10:00:00,2026-03-03 10:00:00,Testbaeckerei,-4.50,0.00,CHF,REVERTED,
TOPUP,Current,2026-03-04 09:00:00,2026-03-04 09:00:00,Aufladung,100.00,0.00,CHF,COMPLETED,1087.70
`;

const REVOLUT_DE = `Art;Produkt;Startdatum;Abschlussdatum;Beschreibung;Betrag;Gebühr;Währung;Status;Saldo
Kartenzahlung;Aktuell;01.03.2026 12:30;02.03.2026 08:00;Testmarkt;-1'012.30;0,00;CHF;Abgeschlossen;1.000,00
`;

const REVOLUT_FX = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-03-05 12:30:00,2026-03-06 08:00:00,Test Shop Euroland,-10.00,0.50,EUR,COMPLETED,89.50
`;

describe("Revolut", () => {
  it("liest englische Kopfzeile, nur abgeschlossene Buchungen", () => {
    const res = parseExport(REVOLUT, "account-statement.csv");
    expect(res.bank).toBe("revolut");
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ date: "2026-03-01", bookedAt: "2026-03-02T08:00:00", amount: -1230, amountChf: -1230, currency: "CHF", balance: 98770, description: "Testmarkt Beispielstadt" });
    expect(res.rows[0]!.raw.State).toBe("COMPLETED");
    expect(res.warnings.join(" ")).toMatch(/2 nicht abgeschlossene/);
  });
  it("liest deutsche Kopfzeile mit Semikolon und 1'012.30", () => {
    const res = parseExport(REVOLUT_DE);
    expect(res.bank).toBe("revolut");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ date: "2026-03-01", amount: -101230, balance: 100000 });
  });
  it("Fremdwährung mit Gebühr: Gebühr wird abgezogen, Kurs umgerechnet", () => {
    const res = parseExport(REVOLUT_FX, undefined, { rates: { EUR: 0.95 } });
    expect(res.rows[0]).toMatchObject({ amount: -1050, currency: "EUR", amountChf: -998 });
    expect(res.rows[0]!.chfEstimated).toBeUndefined();
    expect(res.warnings).toEqual([]);
  });
  it("Fremdwährung ohne Kurs: Warnung und chfEstimated", () => {
    const res = parseExport(REVOLUT_FX);
    expect(res.rows[0]).toMatchObject({ amount: -1050, amountChf: -1050, chfEstimated: true });
    expect(res.warnings.join(" ")).toMatch(/Kein Kurs für EUR/);
  });
});

const ZKB_LIKE = `Kontoauszug;Testkonto
IBAN;CH00 0000 0000 0000 0000 0
Zeitraum;01.03.2026 - 31.03.2026
sep=;

Datum;Buchungstext;Belastung CHF;Gutschrift CHF;Valuta;Saldo CHF
02.03.2026;"Kartenzahlung Testmarkt; Filiale 12";12.30;;02.03.2026;987.70
03.03.2026;Lohn Testfirma AG;;650.00;03.03.2026;1'637.70
Total;;12.30;650.00;;
`;

const SINGLE_AMOUNT = `Date,Details,Amount,Balance,Currency
2026-03-02,Testmarkt,"-1,234.50",5000.00,CHF
2026-03-03,Testfirma,650.00,5650.00,CHF
`;

describe("generische Banken", () => {
  it("Vorspannzeilen, Soll/Haben getrennt, Zusammenfassungszeile, IBAN aus Vorspann", () => {
    const res = parseExport(ZKB_LIKE, "export.csv");
    expect(res.needsConfirmation).toBeUndefined();
    expect(res.account).toBe("CH0000000000000000000");
    expect(res.rows.map((r) => [r.date, r.amount, r.balance, r.description])).toEqual([
      ["2026-03-02", -1230, 98770, "Kartenzahlung Testmarkt; Filiale 12"],
      ["2026-03-03", 65000, 163770, "Lohn Testfirma AG"],
    ]);
    expect(res.rows[0]!.bookedAt).toBe("2026-03-02");
    expect(res.warnings.join(" ")).toMatch(/1 Zeilen ohne gültiges Datum/);
  });
  it("erkennt ZKB am Dateinamen, Yuh am Inhalt", () => {
    expect(parseExport(ZKB_LIKE, "ZKB_Export_2026.csv").bank).toBe("zkb");
    expect(parseExport("Yuh Export\nDATE;ACTIVITY NAME;DEBIT;CREDIT\n02.03.2026;Testkauf;5.00;\n").bank).toBe("yuh");
  });
  it("einzelne Betragsspalte mit 1,234.50 in Anführungszeichen", () => {
    const res = parseExport(SINGLE_AMOUNT);
    expect(res.bank).toBe("unbekannt");
    expect(res.rows.map((r) => r.amount)).toEqual([-123450, 65000]);
    expect(res.warnings[0]).toMatch(/Bank nicht erkannt/);
  });
  it("Tab-getrennt, Datum DD/MM/YYYY mit Uhrzeit", () => {
    const res = parseExport("Buchungsdatum\tText\tBetrag\n02/03/2026 14:05\tTestkauf\t-12,30\n");
    expect(res.rows[0]).toMatchObject({ date: "2026-03-02", bookedAt: "2026-03-02T14:05", amount: -1230 });
  });
  it("unsichere Spalten: keine Zeilen, Warnung, Vorschlag; Bestätigung über parseWithMapping", () => {
    const text = "Konto;Wann;Was;Wieviel\nX;02.03.2026;Testkauf;-12.30\n";
    const res = parseExport(text);
    expect(res.needsConfirmation).toBe(true);
    expect(res.rows).toEqual([]);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.suggestedMapping).toBeDefined();
    const parsed = parseWithMapping(text, { ...res.suggestedMapping, date: 1, description: 2, amount: 3, headerRow: 0 });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ date: "2026-03-02", amount: -1230, description: "Testkauf" });
  });
  it("nur Belastung ohne Gutschrift ist nicht sicher", () => {
    const res = parseExport("Datum;Text;Belastung\n02.03.2026;Testkauf;5.00\n");
    expect(res.needsConfirmation).toBe(true);
  });
  it("guessColumns erkennt Synonyme", () => {
    const g = guessColumns(["Buchungsdatum", "Valuta", "Buchungstext", "Soll", "Haben", "Saldo", "Währung"]);
    expect(g.confident).toBe(true);
    expect(g.mapping).toMatchObject({ date: 0, valuta: 1, description: 2, debit: 3, credit: 4, balance: 5, currency: 6 });
    expect(guessColumns(["Foo", "Bar"]).confident).toBe(false);
  });
  it("leere Datei", () => {
    const res = parseExport("");
    expect(res.rows).toEqual([]);
    expect(res.warnings.length).toBe(1);
  });
});

describe("Hash und Doppel", () => {
  const FILE = `Datum;Text;Betrag
02.03.2026;Testkaffee;-4.50
02.03.2026;Testkaffee;-4.50
03.03.2026;Testkaffee;-4.50
`;
  it("zwei gleiche Buchungen am selben Tag behalten beide einen eigenen Hash", () => {
    const rows = parseExport(FILE).rows;
    expect(new Set(rows.map((r) => r.hash)).size).toBe(3);
  });
  it("zweiter Upload derselben Datei ergibt keine neuen Buchungen", () => {
    const first = parseExport(FILE, "a.csv").rows;
    const second = parseExport(FILE, "a (1).csv").rows;
    const { fresh, duplicates } = dedupe(first.map((r) => r.hash), second);
    expect(fresh).toEqual([]);
    expect(duplicates).toHaveLength(3);
  });
  it("neue Datei mit Überschneidung bringt nur die neuen Buchungen", () => {
    const first = parseExport(FILE).rows;
    const more = parseExport(FILE + "04.03.2026;Testkaffee;-4.50\n").rows;
    expect(dedupe(first.map((r) => r.hash), more).fresh.map((r) => r.date)).toEqual(["2026-03-04"]);
  });
  it("anderes Konto ergibt anderen Hash", () => {
    const a = parseExport(FILE, undefined, { account: "A" }).rows[0]!.hash;
    const b = parseExport(FILE, undefined, { account: "B" }).rows[0]!.hash;
    expect(a).not.toBe(b);
  });
});
